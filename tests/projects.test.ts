import 'fake-indexeddb/auto';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { db, createProject, writeProject, deleteProject, loadSharedState, commitChange, renameProject, collectUnusedAssets, projectTitle } from '../src/lib/db';
import { emptyWorkspace, now, uid, type Note } from '../src/types';
import { changesBetween } from '../src/lib/workspaceChanges';
import { captureContext, changeProjectContext, isCurrentContext, projectLock, taskKey } from '../src/lib/projectContext';

const note = (id: string, assetId?: string): Note => ({ id, type: 'manual-note', title: id, originalText: '', userNotes: '', tags: [], position: { x: 0, y: 0 }, width: 320, collapsed: false, hidden: false, color: 'yellow', updatedAt: now(), ...(assetId ? { screenshot: { assetId, sha256: 'a'.repeat(64), size: 3, width: 1, height: 1, rotation: 0, pageIndex: 0, region: { x: 0, y: 0, width: 1, height: 1 } } } : {}) });
beforeEach(async () => { await db.delete(); await db.open(); });
afterAll(async () => { await db.delete(); });

it('starts empty, validates names, and permits duplicate names with independent UUIDs', async () => {
  expect(await db.projects.count()).toBe(0);
  expect(() => projectTitle('  ')).toThrow(); expect(() => projectTitle('a'.repeat(101))).toThrow();
  const a = await createProject('  同名  '); const b = await createProject('同名');
  expect(a).not.toBe(b); expect((await loadSharedState(a)).workspace.title).toBe('同名');
  expect(await db.projects.count()).toBe(2);
});

it('isolates identical note, PDF, image and draft IDs across two projects', async () => {
  for (const id of ['a', 'b']) {
    const w = emptyWorkspace(id, id); w.notes = [note('same')];
    await writeProject(w, [{ id: 'pdf', blob: new Blob([id]) }], [{ id: 'image', sha256: id, blob: new Blob([id]) }]);
  }
  const a = await loadSharedState('a'); const next = structuredClone(a.workspace); next.notes[0].userNotes = 'Only A';
  const change = { id: 'same-change', projectId: 'a', epoch: a.version.epoch, patches: changesBetween(a.workspace, next) };
  await commitChange(change); await commitChange(change);
  expect((await loadSharedState('a')).version.revision).toBe(a.version.revision + 1);
  expect((await loadSharedState('b')).workspace.notes[0].userNotes).toBe('');
  expect(await (await db.documents.get(['b', 'pdf']))!.blob.text()).toBe('b');
  expect((await db.assets.get(['b', 'image']))!.sha256).toBe('b');
  await commitChange({ ...change, id: uid(), epoch: 'stale' });
  await commitChange({ ...change, projectId: 'b', id: change.id, epoch: 'stale' });
  expect(await db.drafts.count()).toBe(2);
  await renameProject('a', 'New A');
  expect((await db.projects.get('a'))!.title).toBe('New A');
  expect((await db.projects.get('a'))!.noteCount).toBe(1);
});

it('deletes atomically with a tombstone, and stale edits cannot resurrect the project', async () => {
  const a = await createProject('A'); const b = await createProject('B'); const initial = await loadSharedState(a);
  await db.assets.put({ projectId: a, id: 'image', sha256: '', blob: new Blob(['a']) });
  await db.assets.put({ projectId: b, id: 'image', sha256: '', blob: new Blob(['b']) });
  await deleteProject(a);
  await expect(loadSharedState(a)).rejects.toThrow('已刪除');
  await expect(commitChange({ id: uid(), projectId: a, epoch: initial.version.epoch, patches: [] })).rejects.toThrow('已刪除');
  await expect(writeProject(initial.workspace)).rejects.toThrow('已刪除');
  expect((await db.sync.get(a))!.state).toBe('deleted');
  expect(await db.assets.get([a, 'image'])).toBeUndefined();
  expect(await (await db.assets.get([b, 'image']))!.blob.text()).toBe('b');
});

it('clear keeps project identity and creation date and removes only its own attachments and drafts', async () => {
  const a = await createProject('A'); const b = await createProject('B'); const meta = await db.projects.get(a);
  for (const id of [a, b]) {
    await db.documents.put({ projectId: id, id: 'pdf', blob: new Blob(['pdf']) });
    await db.drafts.put({ id: 'draft', projectId: id, epoch: 'old', patches: [], reason: '', createdAt: now() });
  }
  await writeProject(emptyWorkspace(a, 'A'), [], [], 'clear');
  expect((await db.projects.get(a))!.createdAt).toBe(meta!.createdAt);
  expect(await db.documents.get([a, 'pdf'])).toBeUndefined(); expect(await db.drafts.get([a, 'draft'])).toBeUndefined();
  expect(await db.documents.get([b, 'pdf'])).toBeDefined(); expect(await db.drafts.get([b, 'draft'])).toBeDefined();
});

it('garbage collection retains references from every project and both sides of drafts', async () => {
  const a = emptyWorkspace('a', 'A'); const b = emptyWorkspace('b', 'B'); b.notes = [note('b', 'used')];
  await writeProject(a); await writeProject(b);
  await db.drafts.put({ id: 'draft', projectId: 'a', epoch: 'old', reason: '', createdAt: now(), patches: [{ collection: 'notes', id: 'draft-note', before: note('draft-note', 'draft-before'), after: note('draft-note', 'draft-after') }] });
  for (const projectId of ['a', 'b']) for (const id of ['used', 'draft-before', 'draft-after', 'unused']) await db.assets.put({ projectId, id, sha256: '', blob: new Blob(['png']) });
  await collectUnusedAssets();
  expect(await db.assets.toCollection().primaryKeys()).toEqual([['a', 'draft-after'], ['a', 'draft-before'], ['b', 'used']]);
});

it('JSON replacement reuses matching own PDFs but never mismatched same-ID files', async () => {
  const a = emptyWorkspace('a', 'A'); a.documents = [{ id: 'pdf', name: 'A.pdf', size: 3, sha256: 'a'.repeat(64), pageCount: 1, pages: ['A'], createdAt: now() }];
  await writeProject(a, [{ id: 'pdf', blob: new Blob(['aaa']) }]);
  await writeProject(a, [], [], 'replace'); expect(await db.documents.get(['a', 'pdf'])).toBeDefined();
  const other = structuredClone(a); other.documents[0].sha256 = 'b'.repeat(64);
  await writeProject(other, [], [], 'replace'); expect(await db.documents.get(['a', 'pdf'])).toBeUndefined();
});

it('invalidates A → B → A callbacks and gives project tasks independent identities', () => {
  changeProjectContext('a'); const context = captureContext(); const key = taskKey('same');
  changeProjectContext('b'); expect(taskKey('same')).not.toBe(key);
  expect(projectLock('full-summary', 'a')).not.toBe(projectLock('full-summary', 'b'));
  changeProjectContext('a'); expect(isCurrentContext(context)).toBe(false);
});
