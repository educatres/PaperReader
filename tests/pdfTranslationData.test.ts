import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, now } from '../src/types';
import { textHash } from '../src/lib/pdfParagraphs';
import { applyPatches, changesBetween, invertPatches } from '../src/lib/workspaceChanges';
vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: () => {} });
vi.stubGlobal('document', { addEventListener: () => {} });
vi.stubGlobal('localStorage', { getItem: () => null });
vi.mock('../src/lib/pdf', () => ({ sha256: async () => '', resetPdfCache: () => {} }));
const { validateWorkspace, readImport } = await import('../src/lib/transfer');
const { db, loadWorkspace } = await import('../src/lib/db');

async function fixture() {
  const w = emptyWorkspace(); const sourceHash = await textHash('Evidence.');
  w.documents = [{ id: 'pdf', name: 'Test.pdf', sha256: 'a'.repeat(64), size: 6, pageCount: 2, pages: ['Evidence.', ''], createdAt: now() }];
  w.pdfLayouts = [{ id: 'layout', documentId: 'pdf', documentHash: 'a'.repeat(64), layoutVersion: 1, pageIndex: 0, width: 612, height: 792, rotation: 0, viewBox: [0,0,612,792], warnings: [] }];
  w.pdfParagraphs = [{ id: 'para', documentId: 'pdf', layoutId: 'layout', layoutVersion: 1, pageIndex: 0, regionId: 'body', columnId: 0, order: 0,
    rawText: 'Evidence.', normalizedText: 'Evidence.', sourceHash, itemIndices: [0], lines: [{ x: .1, y: .1, width: .3, height: .02 }], columnBounds: { left: .1, right: .4 }, role: 'text' }];
  const result = { text: '證據。', provider: 'openai' as const, model: 'test', reasoningEffort: 'medium' as const, createdAt: now() };
  w.pdfTranslations = [{ ...result, id: 'translation', paragraphId: 'para', documentId: 'pdf', sourceHash, layoutVersion: 1 }];
  w.pdfTranslationJobs = [{ id: 'job', documentId: 'pdf', documentHash: 'a'.repeat(64), layoutVersion: 1, provider: 'openai', model: 'test', reasoningEffort: 'medium',
    targets: [{ paragraphId: 'para', sourceHash, parts: [{ start: 0, end: 9, result }], status: 'translated' }], status: 'complete', createdAt: now(), updatedAt: now() }];
  return w;
}
describe('portable paragraph translations', () => {
  it('roundtrips source positions, complete translations and task parts with allowlisted metadata', async () => {
    const w = await fixture();
    const restored = await readImport(new File([JSON.stringify({ ...w, apiKey: 'secret' })], 'translations.json'));
    expect(restored.workspace).toEqual(w); expect(JSON.stringify(restored.workspace)).not.toContain('secret');
  });
  it('upgrades v1 while retaining legacy research and summary jobs', async () => {
    const w = await fixture();
    w.notes.push({ id: 'note', type: 'manual-note', title: '研究', originalText: '', userNotes: '筆記', tags: [], position: { x: 1, y: 2 }, width: 320, color: 'yellow', hidden: false, collapsed: false, updatedAt: now() });
    w.jobs.push({ id: 'summary', documentId: 'pdf', provider: 'openai', model: 'old', chunks: [{ text: 'Evidence.', startPage: 1, endPage: 1 }], results: [null], status: 'paused', createdAt: now() });
    const old = { ...w, schemaVersion: 1 };
    const migrated = validateWorkspace(old);
    expect(migrated.schemaVersion).toBe(2); expect(migrated.notes).toEqual(w.notes); expect(migrated.jobs).toEqual(w.jobs);
    expect(migrated.pdfParagraphs).toEqual([]);
  });
  it('rejects cross-page/version/hash links, column overflow, duplicate records and missing parts', async () => {
    const w = await fixture();
    const mutations = [
      (v: typeof w) => { v.pdfParagraphs[0].pageIndex = 1; },
      (v: typeof w) => { v.pdfParagraphs[0].layoutVersion = 2; },
      (v: typeof w) => { v.pdfTranslations[0].sourceHash = 'b'.repeat(64); },
      (v: typeof w) => { v.pdfParagraphs[0].lines[0].width = .7; },
      (v: typeof w) => { v.pdfTranslations.push(v.pdfTranslations[0]); },
      (v: typeof w) => { v.pdfTranslationJobs[0].targets[0].parts[0].start = 1; },
      (v: typeof w) => { delete v.pdfTranslationJobs[0].targets[0].parts[0].result; },
      (v: typeof w) => { v.pdfTranslationJobs[0].targets[0].parts[0].result!.reasoningEffort = 'high'; },
    ];
    for (const mutate of mutations) { const bad = structuredClone(w); mutate(bad); expect(() => validateWorkspace(bad)).toThrow(); }
    w.pdfParagraphs[0].normalizedText = 'Tampered.';
    await expect(readImport(new File([JSON.stringify(w)], 'bad.json'))).rejects.toThrow('校驗碼');
  });
  it('merges translation changes with unrelated notes, rejects a deleted source, and restores all collections with undo', async () => {
    const w = await fixture(); const before = emptyWorkspace();
    const patches = changesBetween(before, w);
    const applied = applyPatches(before, patches)!;
    expect(applied.pdfTranslations).toEqual(w.pdfTranslations);
    expect(applyPatches(applied, invertPatches(patches))!.pdfParagraphs).toEqual([]);
    const changed = structuredClone(w); changed.pdfTranslations[0].text = '更新';
    const stale = changesBetween(w, changed);
    expect(applyPatches(emptyWorkspace(), stale)).toBeUndefined();
  });
});
it('upgrades a real v3 IndexedDB record and isolates new research from old-client writes', async () => {
  const w = await fixture();
  const { pdfLayouts, pdfParagraphs, pdfTranslations, pdfTranslationJobs, ...legacyFields } = w;
  const legacy = new Dexie('PaperReader'); legacy.version(3).stores({ workspaces: 'id', documents: 'id', assets: 'id', sync: 'id', drafts: 'id' });
  await legacy.table('workspaces').put({ ...legacyFields, schemaVersion: 1 });
  await legacy.table('documents').put({ id: 'pdf', blob: new Blob(['legacy']) }); legacy.close();
  await db.open(); const migrated = (await loadWorkspace())!;
  expect(migrated.documents).toEqual(w.documents); expect(migrated.schemaVersion).toBe(2); expect(migrated.pdfTranslationJobs).toEqual([]);
  expect((await db.documents.get('pdf'))!.blob.size).toBe(6);
  await legacy.open();
  await legacy.table('workspaces').put({ ...legacyFields, schemaVersion: 1, title: 'Old client overwrite' });
  legacy.close();
  await db.open();
  expect((await loadWorkspace())!.title).toBe(w.title);
  await db.delete();
});
