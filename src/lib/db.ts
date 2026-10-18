import Dexie, { type Table } from 'dexie';
import type { Workspace } from '../types';

class PaperReaderDB extends Dexie {
  workspaces!: Table<Workspace, string>;
  documents!: Table<{ id: string; blob: Blob }, string>;
  constructor() {
    super('PaperReader');
    this.version(1).stores({ workspaces: 'id', documents: 'id' });
  }
}
export const db = new PaperReaderDB();
export async function loadWorkspace() {
  const ws = await db.workspaces.get('default');
  if (ws) ws.jobs = ws.jobs.map(j => ({ ...j, status: j.status === 'running' ? 'paused' : j.status }));
  return ws;
}
export async function saveWorkspace(workspace: Workspace) {
  // A whole snapshot is one atomic record: a highlight and its note cannot save separately.
  await db.workspaces.put(structuredClone(workspace));
}
