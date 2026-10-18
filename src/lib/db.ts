import Dexie, { type Table } from 'dexie';
import type { ImageAsset, Workspace } from '../types';

class PaperReaderDB extends Dexie {
  workspaces!: Table<Workspace, string>;
  documents!: Table<{ id: string; blob: Blob }, string>;
  assets!: Table<ImageAsset, string>;
  constructor() {
    super('PaperReader');
    this.version(1).stores({ workspaces: 'id', documents: 'id' });
    this.version(2).stores({ workspaces: 'id', documents: 'id', assets: 'id' });
  }
}
export const db = new PaperReaderDB();
export async function loadWorkspace() {
  const ws = await db.transaction('rw', db.workspaces, db.assets, async () => {
    const saved = await db.workspaces.get('default');
    // History is session-only. Reclaim images only on startup, after all undo/redo
    // references have expired; deleting a note during a session keeps its image.
    const referenced = new Set(saved?.notes.flatMap(n => n.screenshot ? [n.screenshot.assetId] : []));
    const unused = (await db.assets.toCollection().primaryKeys()).filter(id => !referenced.has(id));
    if (unused.length) await db.assets.bulkDelete(unused);
    return saved;
  });
  if (ws) ws.jobs = ws.jobs.map(j => ({ ...j, status: j.status === 'running' ? 'paused' : j.status }));
  return ws;
}
export async function saveWorkspace(workspace: Workspace) {
  // A whole snapshot is one atomic record: a highlight and its note cannot save separately.
  await db.workspaces.put(structuredClone(workspace));
}
