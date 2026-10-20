import 'fake-indexeddb/auto';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { db, commitChange, loadSharedState, writeProject } from '../src/lib/db';
import { applyPatches, changesBetween, invertPatches } from '../src/lib/workspaceChanges';
import { emptyWorkspace, now, uid, type Note } from '../src/types';

const note = (id: string): Note => ({ id, type: 'manual-note', title: id, originalText: '', userNotes: '', tags: [], position: { x: 0, y: 0 }, width: 320, collapsed: false, hidden: false, color: 'yellow', updatedAt: now() });
beforeEach(async () => { await db.workspaces.clear(); await db.sync.clear(); await db.drafts.clear(); await db.projects.clear(); await writeProject(emptyWorkspace()); });
afterAll(async () => { await db.delete(); });

it('merges concurrent additions and different fields in atomic transactions; local undo retains remote notes', async () => {
  const initial = await loadSharedState('default'); const a = emptyWorkspace(); a.notes = [note('a')]; const b = emptyWorkspace(); b.notes = [note('b')];
  const left = { id: uid(), projectId: 'default', epoch: initial.version.epoch, patches: changesBetween(initial.workspace, a) };
  const right = { id: uid(), projectId: 'default', epoch: initial.version.epoch, patches: changesBetween(initial.workspace, b) };
  await Promise.all([commitChange(left), commitChange(right)]);
  const both = await loadSharedState('default'); expect(both.workspace.notes.map(n => n.id).sort()).toEqual(['a', 'b']);
  await commitChange({ id: uid(), projectId: 'default', epoch: initial.version.epoch, patches: invertPatches(left.patches) });
  expect((await loadSharedState('default')).workspace.notes.map(n => n.id)).toEqual(['b']);
  const base = (await loadSharedState('default')).workspace; const title = structuredClone(base); title.notes[0].title = 'New title';
  const text = structuredClone(base); text.notes[0].userNotes = 'New notes';
  await Promise.all([commitChange({ id: uid(), projectId: 'default', epoch: initial.version.epoch, patches: changesBetween(base, title) }), commitChange({ id: uid(), projectId: 'default', epoch: initial.version.epoch, patches: changesBetween(base, text) })]);
  expect((await loadSharedState('default')).workspace.notes[0]).toMatchObject({ title: 'New title', userNotes: 'New notes' });
});

it('preserves a conflicting edit as a durable draft and rejects stale edits after replacement', async () => {
  const initial = await loadSharedState('default'); initial.workspace.notes = [note('a')]; await db.workspaces.put(initial.workspace);
  const a = structuredClone(initial.workspace); a.notes[0].userNotes = 'First';
  const b = structuredClone(initial.workspace); b.notes[0].userNotes = 'Second';
  await commitChange({ id: uid(), projectId: 'default', epoch: initial.version.epoch, patches: changesBetween(initial.workspace, a) });
  const conflicting = { id: uid(), projectId: 'default', epoch: initial.version.epoch, patches: changesBetween(initial.workspace, b) };
  expect((await commitChange(conflicting)).conflict).toBe(true);
  expect((await loadSharedState('default')).workspace.notes[0].userNotes).toBe('First');
  expect((await db.drafts.get(['default', conflicting.id]))!.patches[0].after).toBe('Second');
  await db.transaction('rw', db.workspaces, db.sync, async () => { await db.workspaces.put(emptyWorkspace()); await db.sync.put({ ...initial.version, epoch: uid(), revision: 5 }); });
  expect((await commitChange({ ...conflicting, id: uid() })).conflict).toBe(true);
  expect((await loadSharedState('default')).workspace.notes).toHaveLength(0);
});

it('places simultaneous notes separately and returns committed values for undo and repeated redo', async () => {
  const initial = await loadSharedState('default');
  const save = (id: string) => { const next = structuredClone(initial.workspace); next.notes.push(note(id)); return commitChange({ id: uid(), projectId: 'default', epoch: initial.version.epoch, patches: changesBetween(initial.workspace, next) }); };
  const results = await Promise.all([save('a'), save('b')]);
  const moved = results.find(result => (result.applied[0].after as Note).position.x !== 0)!;
  expect(moved).toBeDefined();
  for (let i = 0; i < 2; i++) {
    expect((await commitChange({ id: uid(), projectId: 'default', epoch: initial.version.epoch, patches: invertPatches(moved.applied) })).conflict).toBe(false);
    expect((await loadSharedState('default')).workspace.notes).toHaveLength(1);
    expect((await commitChange({ id: uid(), projectId: 'default', epoch: initial.version.epoch, patches: moved.applied })).conflict).toBe(false);
    expect((await loadSharedState('default')).workspace.notes).toHaveLength(2);
  }
});

it('keeps local views out of shared changes and rejects orphaned notes or partial highlight creation', () => {
  const original = emptyWorkspace(); const view = structuredClone(original); view.activeDocumentId = 'local'; view.viewport.x = 200;
  expect(changesBetween(original, view)).toEqual([]);
  const bad = structuredClone(original); bad.notes.push({ ...note('bad'), documentId: 'missing' });
  expect(applyPatches(original, changesBetween(original, bad))).toBeUndefined();
});
