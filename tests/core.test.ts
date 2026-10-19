import { describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, now, type Note } from '../src/types';

// Storage and PDF/browser rendering are exercised in the browser suite. These tests
// protect data validation, chunk coverage, and accidental credential persistence.
vi.stubGlobal('window', { addEventListener: () => {} });
vi.stubGlobal('document', { addEventListener: () => {} });
vi.stubGlobal('localStorage', { getItem: () => null });
vi.mock('../src/lib/pdf', () => ({ sha256: async () => '', resetPdfCache: () => {} }));
const { validateWorkspace, readImport } = await import('../src/lib/transfer');
const { chunkDocument, setKey, hasKey, clearAllKeys } = await import('../src/lib/ai');
const { normalizeText } = await import('../src/lib/anchors');
const { prepareGroupSummary } = await import('../src/lib/groupSummary');
function manualNote(): Note { return { id: 'note-1', type: 'manual-note', title: 'Idea', originalText: '', userNotes: 'Evidence', tags: [], position: { x: 0, y: 0 }, width: 320, collapsed: false, hidden: false, color: 'yellow', updatedAt: now() }; }
describe('portable data boundary', () => {
  it('validates screenshot page, attachment consistency and bounded canonical coordinates', () => {
    const w = emptyWorkspace();
    w.documents = [{ id: 'pdf', name: 'Figure.pdf', sha256: 'a'.repeat(64), size: 10, pageCount: 2, pages: ['', ''], createdAt: now() }];
    w.notes = [{ ...manualNote(), type: 'screenshot-note', documentId: 'pdf', screenshot: { assetId: 'png', sha256: 'b'.repeat(64), size: 150, width: 120, height: 90, pageIndex: 1, rotation: 270, region: { x: .2, y: .1, width: .4, height: .3 } } }];
    expect(validateWorkspace(w).notes[0].screenshot).toEqual(w.notes[0].screenshot);
    const badPage = structuredClone(w); badPage.notes[0].screenshot!.pageIndex = 2;
    expect(() => validateWorkspace(badPage)).toThrow('截圖便條');
    const badRegion = structuredClone(w); badRegion.notes[0].screenshot!.region.width = .9;
    expect(() => validateWorkspace(badRegion)).toThrow();
    const missing = structuredClone(w); delete missing.notes[0].screenshot;
    expect(() => validateWorkspace(missing)).toThrow('截圖便條');
    const conflict = structuredClone(w); conflict.notes.push({ ...structuredClone(w.notes[0]), id: 'other' }); conflict.notes[1].screenshot!.sha256 = 'c'.repeat(64);
    expect(() => validateWorkspace(conflict)).toThrow('資料不一致');
  });
  it('strips unexpected secret fields and preserves the supported schema', () => {
    const w = { ...emptyWorkspace(), apiKey: 'secret-never-export', notes: [{ ...manualNote(), authorization: 'secret-never-export' }] };
    const parsed = validateWorkspace(w);
    expect(JSON.stringify(parsed)).not.toContain('secret-never-export'); expect(parsed.notes).toHaveLength(1);
  });
  it('rejects dangling relationships, duplicate IDs and invalid source anchors', () => {
    const w = emptyWorkspace(); w.notes = [manualNote(), manualNote()];
    expect(() => validateWorkspace(w)).toThrow('重複 ID');
    w.notes = [manualNote()]; w.edges = [{ id: 'edge-1', source: 'note-1', target: 'missing', relationType: '相關', label: '', directed: false, createdBy: 'user', createdAt: now(), updatedAt: now() }];
    expect(() => validateWorkspace(w)).toThrow('不存在');
  });
  it('rejects a JSON schema newer than this application', async () => {
    await expect(readImport(new File([JSON.stringify({ schemaVersion: 99 })], 'bad.json'))).rejects.toThrow();
  });
  it.each(['cgu', 'mercuryapi'] as const)('roundtrips %s reasoning metadata and accepts older backups without it', provider => {
    const w = emptyWorkspace();
    w.documents.push({ id: 'paper-1', name: 'Paper.pdf', sha256: 'a'.repeat(64), size: 10, pageCount: 1, pages: ['Evidence'], createdAt: now() });
    const result = { text: '摘要', provider, model: 'gpt-6-luna', reasoningEffort: 'high' as const, createdAt: now() };
    w.notes.push({ ...manualNote(), summary: result });
    w.jobs.push({ id: 'job-1', documentId: 'paper-1', provider, model: 'gpt-6-luna', reasoningEffort: 'high', chunks: [{ text: 'Evidence', startPage: 1, endPage: 1 }], results: [result], status: 'paused', createdAt: now() });
    const restored = validateWorkspace(JSON.parse(JSON.stringify(w)));
    expect(restored.jobs[0].reasoningEffort).toBe('high');
    expect(restored.notes[0].summary).toEqual(result);
    delete w.jobs[0].reasoningEffort; delete w.notes[0].summary!.reasoningEffort;
    expect(validateWorkspace(w).jobs[0].reasoningEffort).toBeUndefined();
  });
  it('roundtrips Grok results and resumable jobs with model-default reasoning', async () => {
    const w = emptyWorkspace();
    w.documents.push({ id: 'paper-1', name: 'Paper.pdf', sha256: 'a'.repeat(64), size: 10, pageCount: 1, pages: ['Evidence'], createdAt: now() });
    const result = { text: 'Grok 摘要', provider: 'grok' as const, model: 'grok-text', createdAt: now(), usage: 42 };
    w.notes.push({ ...manualNote(), summary: result });
    w.jobs.push({ id: 'job-1', documentId: 'paper-1', provider: 'grok', model: 'grok-text', chunks: [{ text: 'Evidence', startPage: 1, endPage: 1 }], results: [result], status: 'paused', createdAt: now() });
    const restored = await readImport(new File([JSON.stringify(w)], 'grok.json'));
    expect(restored.workspace.notes[0].summary).toEqual(result);
    expect(restored.workspace.jobs[0]).toEqual(w.jobs[0]);
    expect(restored.workspace.jobs[0].reasoningEffort).toBeUndefined();
  });
  it('preserves group provenance in backups after source deletion and rejects corrupt snapshots', () => {
    const w = emptyWorkspace(); w.notes = [manualNote(), { ...manualNote(), id: 'note-2', title: 'Another idea' }];
    w.edges = [{ id: 'relation-1', source: 'note-1', target: 'note-2', relationType: '支持', label: 'Evidence supports the idea', directed: true, createdBy: 'user', createdAt: now(), updatedAt: now() }];
    const plan = prepareGroupSummary(w, 'note-1');
    w.notes.push({ ...manualNote(), id: 'group-1', type: 'group-summary', title: plan.title, originalText: plan.sourceText, groupSummary: plan.provenance });
    w.notes = w.notes.filter(n => n.id !== 'note-2'); w.edges = [];
    const parsed = validateWorkspace(JSON.parse(JSON.stringify(w)));
    expect(parsed.notes[1].groupSummary).toEqual(plan.provenance);
    parsed.notes[1].groupSummary!.relations[0].target = 'not-a-snapshot-source';
    expect(() => validateWorkspace(parsed)).toThrow('來源快照關係無效');
  });
});
describe('source-preserving text chunking', () => {
  it('covers long pages without gaps and retains exact source page ranges', () => {
    const pages = ['A'.repeat(23000), '', 'Third page findings.'];
    const chunks = chunkDocument(pages, 1000);
    expect(chunks.length).toBeGreaterThan(20);
    const reconstructed = chunks.map(c => c.text.replace(/\[第 \d+ 頁\]\n/g, '')).join('').replace(/\s/g, '');
    expect(reconstructed).toContain(pages[0]);
    expect(chunks.at(-1)?.endPage).toBe(3);
    expect(chunks.every(c => c.text.length <= 1000)).toBe(true);
  });
  it('has no chunks for scanned pages and normalizes line-break hyphenation', () => {
    expect(chunkDocument(['', '  '])).toEqual([]);
    expect(normalizeText('a con-\nnection   matters')).toBe('a connection matters');
  });
});
describe('session-only credentials', () => {
  it('clears independent providers without affecting research data', () => {
    setKey('openai', 'test-key-a'); setKey('gemini', 'test-key-b'); setKey('cgu', 'test-key-c'); setKey('mercuryapi', 'test-key-d'); setKey('grok', 'test-key-e');
    expect(hasKey('openai')).toBe(true); expect(hasKey('gemini')).toBe(true);
    setKey('openai', ''); expect(hasKey('openai')).toBe(false); expect(hasKey('gemini')).toBe(true);
    expect(hasKey('cgu')).toBe(true); expect(hasKey('mercuryapi')).toBe(true);
    expect(hasKey('grok')).toBe(true); setKey('grok', ''); expect(hasKey('grok')).toBe(false); expect(hasKey('mercuryapi')).toBe(true);
    setKey('grok', 'test-key-e');
    clearAllKeys(); expect(hasKey('gemini')).toBe(false); expect(hasKey('cgu')).toBe(false); expect(hasKey('mercuryapi')).toBe(false);
    expect(hasKey('grok')).toBe(false);
    expect(JSON.stringify(emptyWorkspace())).not.toContain('test-key');
  });
});
