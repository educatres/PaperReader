import Dexie, { type Table } from 'dexie';
import { emptyWorkspace, uid, type ImageAsset, type Workspace } from '../types';
import { applyPatches, changesBetween, type Change, type ConflictDraft, type SyncVersion } from './workspaceChanges';
import { upgradeWorkspace } from './workspaceVersion';

class PaperReaderDB extends Dexie {
  workspaces!: Table<Workspace, string>;
  documents!: Table<{ id: string; blob: Blob }, string>;
  assets!: Table<ImageAsset, string>;
  sync!: Table<SyncVersion, string>;
  drafts!: Table<ConflictDraft, string>;
  constructor() {
    super('PaperReader');
    this.version(1).stores({ workspaces: 'id', documents: 'id' });
    this.version(2).stores({ workspaces: 'id', documents: 'id', assets: 'id' });
    this.version(3).stores({ workspaces: 'id', documents: 'id', assets: 'id', sync: 'id', drafts: 'id' });
    this.version(4).stores({ workspaces: 'id', documents: 'id', assets: 'id', sync: 'id', drafts: 'id' }).upgrade(async transaction => {
      await transaction.table('workspaces').toCollection().modify(record => Object.assign(record, upgradeWorkspace(record)));
    });
    // Dexie can reopen a newer DB using an older declared version. Move the
    // workspace store so a v1 client cannot silently write over v2 research.
    this.version(5).stores({ workspacesV2: 'id' }).upgrade(async transaction => {
      const records = await transaction.table('workspaces').toArray();
      await transaction.table('workspacesV2').bulkPut(records.map(upgradeWorkspace));
    });
    this.version(6).stores({ workspaces: null });
    this.workspaces = this.table('workspacesV2');
    this.on('versionchange', () => {
      this.close(); window.dispatchEvent(new Event('paperreader-database-upgraded'));
    });
  }
}
export const db = new PaperReaderDB();
export async function loadWorkspace() {
  const workspace = await db.workspaces.get('default');
  return workspace ? upgradeWorkspace(workspace) : undefined;
}
export async function loadSharedState() {
  return db.transaction('rw', db.workspaces, db.sync, async () => {
    let version = await db.sync.get('default');
    if (!version) { version = { id: 'default', epoch: uid(), revision: 0 }; await db.sync.put(version); }
    return { workspace: await loadWorkspace() || emptyWorkspace(), version };
  });
}
export async function commitChange(change: Change) {
  return db.transaction('rw', db.workspaces, db.sync, db.drafts, async () => {
    const state = await loadSharedState();
    if (state.version.recent?.includes(change.id)) return { ...state, conflict: false, applied: change.patches };
    const workspace = change.epoch === state.version.epoch ? applyPatches(state.workspace, change.patches) : undefined;
    if (!workspace) {
      await db.drafts.put({ ...change, createdAt: new Date().toISOString(), reason: change.epoch !== state.version.epoch ? '研究空間已還原或清空，已保留原視窗的修改。' : '其他視窗已修改相同欄位，或來源已被刪除。' });
      return { ...state, conflict: true, applied: [] };
    }
    for (const patch of change.patches) {
      if (patch.collection !== 'notes' || patch.field || patch.before || !patch.after) continue;
      const note = workspace.notes.find(n => n.id === patch.id)!;
      const others = workspace.notes.filter(n => n.id !== patch.id && !n.hidden);
      const origin = { ...note.position }; const step = Math.max(note.width, ...others.map(n => n.width)) + 45;
      for (let i = 1; i < 1000 && others.some(n => Math.abs(n.position.x - note.position.x) < Math.max(n.width, note.width) + 30 && Math.abs(n.position.y - note.position.y) < 350); i++) note.position = { x: origin.x + (i % 3) * step, y: origin.y + Math.floor(i / 3) * 380 };
    }
    const version = { ...state.version, revision: state.version.revision + 1, recent: [...(state.version.recent || []).slice(-255), change.id] };
    await db.workspaces.put(workspace); await db.sync.put(version);
    return { workspace, version, conflict: false, applied: changesBetween(state.workspace, workspace) };
  });
}

export async function holdWindowStorage(collect = true) {
  if (!navigator.locks) return;
  // Only collect when no open window can still undo a deletion or finish a capture.
  if (collect) await navigator.locks.request('PaperReader.windows', { ifAvailable: true }, async lock => {
    if (!lock) return;
    await db.transaction('rw', db.workspaces, db.assets, db.drafts, async () => {
      const workspace = await loadWorkspace(); const drafts = await db.drafts.toArray();
      const retained = new Set(workspace?.notes.flatMap(n => n.screenshot ? [n.screenshot.assetId] : []));
      function retain(value: unknown) {
        if (!value || typeof value !== 'object') return;
        const object = value as Record<string, unknown>;
        if (typeof object.assetId === 'string') retained.add(object.assetId);
        Object.values(object).forEach(retain);
      }
      drafts.forEach(retain);
      const unused = (await db.assets.toCollection().primaryKeys()).filter(id => !retained.has(String(id)));
      if (unused.length) await db.assets.bulkDelete(unused);
    });
  });
  await new Promise<void>(resolve => {
    void navigator.locks.request('PaperReader.windows', { mode: 'shared' }, async () => {
      resolve(); await new Promise<void>(release => window.addEventListener('pagehide', () => release(), { once: true }));
    });
  });
}
