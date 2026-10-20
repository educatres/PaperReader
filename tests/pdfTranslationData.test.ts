import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, now } from '../src/types';
import { textHash } from '../src/lib/pdfParagraphs';
import { applyPatches, changesBetween, invertPatches } from '../src/lib/workspaceChanges';
import { erasePdfHighlight, erasePdfTranslation } from '../src/lib/pdfAnnotations';
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
  it('erases only the PDF overlay, preserving the complete note, source anchor and relations across backup and undo', async () => {
    const before = await fixture();
    before.highlights.push({ id: 'highlight', noteId: 'note', documentId: 'pdf', pageIndex: 1, displayPage: 2,
      selectedText: 'Evidence.', normalizedText: 'Evidence.', prefix: '', suffix: '', textQuoteHash: 'test', textRange: { start: 0, end: 9 },
      quads: [{ x: .1, y: .2, width: .3, height: .02 }], coordinateSystem: 'normalized', rotation: 0, color: 'yellow', status: 'resolved', schemaVersion: 1, createdAt: now(), updatedAt: now() });
    before.notes.push({ id: 'note', documentId: 'pdf', highlightId: 'highlight', type: 'highlight-note', title: '研究', originalText: 'Evidence.',
      translation: before.pdfTranslations[0], summary: { ...before.pdfTranslations[0], text: '摘要' }, userNotes: '保留我的筆記', tags: ['重要'],
      position: { x: 1, y: 2 }, width: 320, color: 'yellow', hidden: false, collapsed: false, updatedAt: now() });
    before.notes.push({ ...before.notes[0], id: 'other', highlightId: undefined, type: 'manual-note' });
    before.edges.push({ id: 'edge', source: 'note', target: 'other', relationType: '支持', label: '證據', directed: true, createdBy: 'user', createdAt: now(), updatedAt: now() });
    const erased = structuredClone(before); erasePdfHighlight(erased, 'highlight');
    expect(erased.notes).toEqual(before.notes); expect(erased.edges).toEqual(before.edges);
    expect(erased.highlights[0]).toMatchObject({ deletedAt: expect.any(String), displayPage: 2, textRange: before.highlights[0].textRange });
    const restored = await readImport(new File([JSON.stringify(erased)], 'erased.json'));
    expect(restored.workspace.highlights[0].deletedAt).toBe(erased.highlights[0].deletedAt);
    const patches = changesBetween(before, erased);
    expect(patches.every(p => p.collection === 'highlights')).toBe(true);
    const concurrent = structuredClone(erased); concurrent.notes[0].userNotes = '另一視窗新增';
    const undone = applyPatches(concurrent, invertPatches(patches))!;
    expect(undone.highlights[0].deletedAt).toBeUndefined(); expect(undone.notes[0].userNotes).toBe('另一視窗新增');
    expect(applyPatches(undone, patches)!.highlights[0].deletedAt).toBeTruthy();
  });
  it('removes translation results and all saved job parts atomically; undo restores a valid complete job', async () => {
    const before = await fixture(); const erased = structuredClone(before);
    erased.pdfTranslationJobs.push({ ...structuredClone(erased.pdfTranslationJobs[0]), id: 'older-job' });
    erasePdfTranslation(erased, 'para');
    expect(erased.pdfTranslations).toEqual([]); expect(erased.pdfTranslationJobs).toEqual([]);
    expect(validateWorkspace(erased)).toEqual(erased);
    const changes = changesBetween(before, erased);
    expect(validateWorkspace(applyPatches(erased, invertPatches(changes))!)).toEqual({ ...before, updatedAt: expect.any(String) });
  });
  it('pauses affected jobs while retaining other paragraphs and their saved parts', async () => {
    const w = await fixture(); const p = structuredClone(w.pdfParagraphs[0]); p.id = 'other-para'; p.order = 1; w.pdfParagraphs.push(p);
    const target = structuredClone(w.pdfTranslationJobs[0].targets[0]); target.paragraphId = p.id; target.status = 'running';
    w.pdfTranslationJobs[0].targets.push(target); w.pdfTranslationJobs[0].status = 'running';
    erasePdfTranslation(w, 'para');
    expect(w.pdfTranslationJobs[0]).toMatchObject({ status: 'paused', targets: [{ paragraphId: p.id, status: 'pending', parts: target.parts }] });
    expect(validateWorkspace(w)).toEqual(w);
    expect(w.pdfParagraphs).toHaveLength(2);
  });
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
  await db.open(); const migrated = (await loadWorkspace('default'))!;
  expect(migrated.documents).toEqual(w.documents); expect(migrated.schemaVersion).toBe(2); expect(migrated.pdfTranslationJobs).toEqual([]);
  expect((await db.documents.get(['default', 'pdf']))!.blob.size).toBe(6);
  await legacy.open();
  await legacy.table('workspaces').put({ ...legacyFields, schemaVersion: 1, title: 'Old client overwrite' });
  legacy.close();
  await db.open();
  expect((await loadWorkspace('default'))!.title).toBe(w.title);
  await db.delete();
});
