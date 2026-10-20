import Dexie, { type Table } from 'dexie';
import { emptyWorkspace, now, uid, type ImageAsset, type ProjectMeta, type ProjectView, type Workspace } from '../types';
import { applyPatches, changesBetween, type Change, type ConflictDraft, type SyncVersion } from './workspaceChanges';
import { upgradeWorkspace } from './workspaceVersion';

export type ProjectDocument = { projectId: string; id: string; blob: Blob };
export type ProjectAsset = ImageAsset & { projectId: string };
export class ProjectMissingError extends Error { constructor() { super('此專案不存在或已刪除。'); } }
export function projectTitle(value: string) {
  const title = value.trim();
  if (!title || title.length > 100) throw new Error('專案名稱須為 1–100 字元，不能只有空白。');
  return title;
}
function metadata(workspace: Workspace, previous?: ProjectMeta): ProjectMeta {
  return { id: workspace.id, title: workspace.title, createdAt: previous?.createdAt || workspace.updatedAt,
    updatedAt: workspace.updatedAt, documentCount: workspace.documents.length, noteCount: workspace.notes.length,
    ...(previous?.lastOpenedAt ? { lastOpenedAt: previous.lastOpenedAt } : {}) };
}
export class PaperReaderDB extends Dexie {
  workspaces!: Table<Workspace, string>;
  documents!: Table<ProjectDocument, [string, string]>;
  assets!: Table<ProjectAsset, [string, string]>;
  sync!: Table<SyncVersion, string>;
  drafts!: Table<ConflictDraft, [string, string]>;
  projects!: Table<ProjectMeta, string>;
  views!: Table<ProjectView, [string, string]>;
  constructor(name = 'PaperReader') {
    super(name);
    this.version(1).stores({ workspaces: 'id', documents: 'id' });
    this.version(2).stores({ workspaces: 'id', documents: 'id', assets: 'id' });
    this.version(3).stores({ workspaces: 'id', documents: 'id', assets: 'id', sync: 'id', drafts: 'id' });
    this.version(4).stores({ workspaces: 'id', documents: 'id', assets: 'id', sync: 'id', drafts: 'id' }).upgrade(async transaction => {
      await transaction.table('workspaces').toCollection().modify(record => Object.assign(record, upgradeWorkspace(record)));
    });
    this.version(5).stores({ workspacesV2: 'id' }).upgrade(async transaction => {
      await transaction.table('workspacesV2').bulkPut((await transaction.table('workspaces').toArray()).map(upgradeWorkspace));
    });
    this.version(6).stores({ workspaces: null });
    this.version(7).stores({ projects: 'id,updatedAt,title', projectWorkspaces: 'id',
      projectDocuments: '[projectId+id],projectId', projectAssets: '[projectId+id],projectId',
      projectSync: 'id', projectDrafts: '[projectId+id],projectId', projectViews: '[projectId+kind],projectId' }).upgrade(async transaction => {
      const workspaces: Workspace[] = (await transaction.table('workspacesV2').toArray()).map(upgradeWorkspace);
      const drafts = await transaction.table('drafts').toArray();
      if (!workspaces.length && drafts.length) workspaces.push(emptyWorkspace());
      const documents = await transaction.table('documents').toArray();
      const assets = await transaction.table('assets').toArray();
      for (const workspace of workspaces) {
        const projectId = workspace.id;
        await transaction.table('projectWorkspaces').put(workspace);
        await transaction.table('projects').put(metadata(workspace));
        const saved = await transaction.table('sync').get(projectId);
        await transaction.table('projectSync').put({ ...(saved || { id: projectId, epoch: uid(), revision: 0 }), state: 'active' });
        const ownedDocuments = documents.filter(d => projectId === 'default' || workspace.documents.some(p => p.id === d.id));
        const ownedAssets = assets.filter(a => projectId === 'default' || workspace.notes.some(n => n.screenshot?.assetId === a.id));
        await transaction.table('projectDocuments').bulkPut(ownedDocuments.map(d => ({ ...d, projectId })));
        await transaction.table('projectAssets').bulkPut(ownedAssets.map(a => ({ ...a, projectId })));
        if (projectId === 'default') await transaction.table('projectDrafts').bulkPut(drafts.map(d => ({ ...d, projectId })));
      }
    });
    // Copy and removal share one IDB versionchange transaction: quota errors roll
    // back both. Cached older apps can only recreate/clear their old physical stores.
    this.version(8).stores({ workspacesV2: null, documents: null, assets: null, sync: null, drafts: null });
    this.workspaces = this.table('projectWorkspaces'); this.documents = this.table('projectDocuments');
    this.assets = this.table('projectAssets'); this.sync = this.table('projectSync');
    this.drafts = this.table('projectDrafts'); this.projects = this.table('projects'); this.views = this.table('projectViews');
    this.on('versionchange', () => { this.close(); if (typeof window !== 'undefined') window.dispatchEvent(new Event('paperreader-database-upgraded')); });
  }
}
export const db = new PaperReaderDB();
export async function loadWorkspace(projectId: string) {
  const workspace = await db.workspaces.get(projectId);
  return workspace ? upgradeWorkspace(workspace) : undefined;
}
export async function loadSharedState(projectId: string) {
  return db.transaction('r', db.workspaces, db.sync, async () => {
    const workspace = await loadWorkspace(projectId); const version = await db.sync.get(projectId);
    if (!workspace || !version || version.state === 'deleted') throw new ProjectMissingError();
    return { workspace, version };
  });
}
export const projectDrafts = (projectId: string) => db.drafts.where('projectId').equals(projectId).toArray();
export const listProjects = () => db.projects.toArray();
export async function writeProject(workspace: Workspace, documents: { id: string; blob: Blob }[] = [], assets: ImageAsset[] = [], mode: 'create' | 'replace' | 'clear' = 'create') {
  const projectId = workspace.id; workspace = { ...workspace, title: projectTitle(workspace.title) };
  await db.transaction('rw', [db.projects, db.workspaces, db.documents, db.assets, db.sync, db.drafts, db.views], async () => {
    const saved = await db.sync.get(projectId); const previous = await db.projects.get(projectId);
    if (mode === 'create' ? !!saved : (!previous || saved?.state === 'deleted')) throw new ProjectMissingError();
    if (mode === 'clear') {
      await db.documents.where('projectId').equals(projectId).delete(); await db.assets.where('projectId').equals(projectId).delete();
      await db.drafts.where('projectId').equals(projectId).delete();
    }
    if (mode === 'replace') {
      // JSON has no attachments. Reuse only files verified by this project's
      // previous metadata; an identical ID from another backup is insufficient.
      const old = await db.workspaces.get(projectId);
      for (const paper of workspace.documents) {
        if (documents.some(d => d.id === paper.id)) continue;
        const previousPaper = old?.documents.find(d => d.id === paper.id);
        const stored = await db.documents.get([projectId, paper.id]);
        if (stored && (!previousPaper || previousPaper.sha256 !== paper.sha256 || previousPaper.size !== paper.size || stored.blob.size !== paper.size))
          await db.documents.delete([projectId, paper.id]);
      }
      for (const note of workspace.notes) {
        const image = note.screenshot; if (!image || assets.some(a => a.id === image.assetId)) continue;
        const stored = await db.assets.get([projectId, image.assetId]);
        if (stored && (stored.sha256 !== image.sha256 || stored.blob.size !== image.size)) await db.assets.delete([projectId, image.assetId]);
      }
    }
    if (documents.length) await db.documents.bulkPut(documents.map(d => ({ ...d, projectId })));
    if (assets.length) await db.assets.bulkPut(assets.map(a => ({ ...a, projectId })));
    await db.workspaces.put(workspace); await db.projects.put(metadata(workspace, previous));
    await db.sync.put({ id: projectId, epoch: uid(), revision: (saved?.revision || 0) + 1, state: 'active' });
    await db.views.where('projectId').equals(projectId).delete();
  });
}
export async function createProject(title: string) {
  const workspace = emptyWorkspace(uid(), projectTitle(title)); await writeProject(workspace); return workspace.id;
}
export async function deleteProject(projectId: string) {
  await db.transaction('rw', [db.projects, db.workspaces, db.documents, db.assets, db.sync, db.drafts, db.views], async () => {
    const saved = await db.sync.get(projectId);
    if (!saved || saved.state === 'deleted') throw new ProjectMissingError();
    await db.projects.delete(projectId); await db.workspaces.delete(projectId);
    await db.documents.where('projectId').equals(projectId).delete(); await db.assets.where('projectId').equals(projectId).delete();
    await db.drafts.where('projectId').equals(projectId).delete(); await db.views.where('projectId').equals(projectId).delete();
    await db.sync.put({ id: projectId, epoch: uid(), revision: saved.revision + 1, state: 'deleted' });
  });
}
export async function commitChange(change: Change) {
  return db.transaction('rw', db.projects, db.workspaces, db.sync, db.drafts, async () => {
    const state = await loadSharedState(change.projectId);
    if (state.version.recent?.includes(change.id)) return { ...state, conflict: false, applied: change.patches };
    const workspace = change.epoch === state.version.epoch ? applyPatches(state.workspace, change.patches) : undefined;
    if (!workspace) {
      await db.drafts.put({ ...change, createdAt: now(), reason: change.epoch !== state.version.epoch ? '研究空間已還原或清空，已保留原視窗的修改。' : '其他視窗已修改相同欄位，或來源已被刪除。' });
      return { ...state, conflict: true, applied: [] };
    }
    workspace.title = projectTitle(workspace.title);
    for (const patch of change.patches) {
      if (patch.collection !== 'notes' || patch.field || patch.before || !patch.after) continue;
      const note = workspace.notes.find(n => n.id === patch.id)!;
      const others = workspace.notes.filter(n => n.id !== patch.id && !n.hidden);
      const origin = { ...note.position }; const step = Math.max(note.width, ...others.map(n => n.width)) + 45;
      for (let i = 1; i < 1000 && others.some(n => Math.abs(n.position.x - note.position.x) < Math.max(n.width, note.width) + 30 && Math.abs(n.position.y - note.position.y) < 350); i++) note.position = { x: origin.x + (i % 3) * step, y: origin.y + Math.floor(i / 3) * 380 };
    }
    const version = { ...state.version, revision: state.version.revision + 1, recent: [...(state.version.recent || []).slice(-255), change.id] };
    await db.workspaces.put(workspace); await db.sync.put(version);
    await db.projects.put(metadata(workspace, await db.projects.get(change.projectId)));
    return { workspace, version, conflict: false, applied: changesBetween(state.workspace, workspace) };
  });
}
export async function renameProject(projectId: string, title: string) {
  title = projectTitle(title); const state = await loadSharedState(projectId);
  return commitChange({ id: uid(), projectId, epoch: state.version.epoch, patches: [{ collection: 'workspace', field: 'title', before: state.workspace.title, after: title }] });
}
export async function collectUnusedAssets() {
  await db.transaction('rw', db.workspaces, db.assets, db.drafts, async () => {
    const retained = new Set<string>();
    function retain(projectId: string, value: unknown) {
      if (!value || typeof value !== 'object') return;
      const object = value as Record<string, unknown>;
      if (typeof object.assetId === 'string') retained.add(`${projectId}\0${object.assetId}`);
      Object.values(object).forEach(item => retain(projectId, item));
    }
    for (const workspace of await db.workspaces.toArray()) retain(workspace.id, workspace.notes);
    for (const draft of await db.drafts.toArray()) retain(draft.projectId, draft.patches);
    const unused = (await db.assets.toCollection().primaryKeys()).filter(([projectId, id]) => !retained.has(`${projectId}\0${id}`));
    if (unused.length) await db.assets.bulkDelete(unused);
  });
}
export async function holdWindowStorage(collect = true) {
  if (!navigator.locks) return;
  if (collect) await navigator.locks.request('PaperReader.projects.windows', { ifAvailable: true }, async lock => { if (lock) await collectUnusedAssets(); });
  await new Promise<void>(resolve => {
    void navigator.locks.request('PaperReader.projects.windows', { mode: 'shared' }, async () => {
      resolve(); await new Promise<void>(release => window.addEventListener('pagehide', () => release(), { once: true }));
    });
  });
}
