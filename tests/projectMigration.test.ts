import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it, vi } from 'vitest';
import { PaperReaderDB } from '../src/lib/db';
import { emptyWorkspace, now } from '../src/types';

async function legacy(name: string, version = 6) {
  const db = new Dexie(name);
  db.version(version).stores({ workspacesV2: 'id', documents: 'id', assets: 'id', sync: 'id', drafts: 'id' });
  await db.open(); return db;
}
it('migrates all v6 content, Blob orphans, sync and drafts, then removes old physical stores', async () => {
  const old = await legacy('migration'); const w = emptyWorkspace();
  w.jobs = [{ id: 'job', documentId: 'pdf', provider: 'openai', model: 'test', chunks: [], results: [], status: 'paused', createdAt: now() }];
  await old.table('workspacesV2').put(w);
  await old.table('documents').put({ id: 'orphan-pdf', blob: new Blob(['pdf']) });
  await old.table('assets').put({ id: 'undo-image', blob: new Blob(['png']), sha256: 'hash' });
  await old.table('drafts').put({ id: 'draft', patches: [], epoch: 'epoch', reason: 'unsaved', createdAt: now() });
  await old.table('sync').put({ id: 'default', epoch: 'epoch', revision: 8 }); old.close();
  const db = new PaperReaderDB('migration'); await db.open();
  expect(await db.workspaces.get('default')).toEqual(w);
  expect((await db.sync.get('default'))!.revision).toBe(8);
  expect((await db.drafts.get(['default', 'draft']))!.reason).toBe('unsaved');
  expect(await (await db.documents.get(['default', 'orphan-pdf']))!.blob.text()).toBe('pdf');
  expect(await db.assets.get(['default', 'undo-image'])).toBeDefined();
  expect(db.backendDB().objectStoreNames.contains('documents')).toBe(false);
  expect(db.backendDB().objectStoreNames.contains('workspacesV2')).toBe(false);
  // A cached client can recreate its old stores; clearing them leaves v8 data safe.
  db.close(); await old.open(); await old.table('documents').clear(); await old.table('assets').clear(); await old.table('workspacesV2').clear(); old.close();
  await db.open(); expect(await db.documents.count()).toBe(1); expect(await db.assets.count()).toBe(1); expect(await db.projects.count()).toBe(1);
  await db.delete();
});

it('preserves a draft-only installation, but does not create a project for an empty installation', async () => {
  const old = await legacy('draft-only'); await old.table('drafts').put({ id: 'draft', patches: [], epoch: 'old', reason: '', createdAt: now() }); old.close();
  const draftDB = new PaperReaderDB('draft-only'); await draftDB.open(); expect(await draftDB.projects.count()).toBe(1); expect(await draftDB.drafts.count()).toBe(1); await draftDB.delete();
  const empty = new PaperReaderDB('empty-install'); await empty.open(); expect(await empty.projects.count()).toBe(0); await empty.delete();
});

it('rolls the whole upgrade back after a quota failure and can retry without duplication', async () => {
  const old = await legacy('rollback'); await old.table('workspacesV2').put(emptyWorkspace());
  await old.table('assets').put({ id: 'image', blob: new Blob(['png']), sha256: 'hash' }); old.close();
  const original = IDBObjectStore.prototype.put;
  const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'projectAssets') throw new DOMException('test quota', 'QuotaExceededError');
    return original.apply(this, args);
  });
  const db = new PaperReaderDB('rollback'); await expect(db.open()).rejects.toBeDefined(); fail.mockRestore(); db.close();
  await old.open(); expect(old.backendDB().version).toBe(60); expect(await old.table('assets').count()).toBe(1); expect(await old.table('workspacesV2').count()).toBe(1); old.close();
  await db.open(); expect(await db.projects.count()).toBe(1); expect(await db.assets.count()).toBe(1); await db.delete();
});
