import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it, vi } from 'vitest';
import { emptyWorkspace, now, type Screenshot } from '../src/types';

vi.stubGlobal('window', { addEventListener: () => {} });
vi.stubGlobal('document', { addEventListener: () => {} });
vi.stubGlobal('localStorage', { getItem: () => null });
const { db, loadWorkspace } = await import('../src/lib/db');
const { useApp, addScreenshot, deleteNotes, flushSave } = await import('../src/store');

it('upgrades v1 without losing PDFs; keeps undo images and reclaims expired ones; failed or stale captures create nothing', async () => {
  const legacy = new Dexie('PaperReader'); legacy.version(1).stores({ workspaces: 'id', documents: 'id' });
  const w = emptyWorkspace(); w.documents.push({ id: 'pdf', name: 'Legacy.pdf', sha256: 'a'.repeat(64), size: 6, pageCount: 1, pages: ['Legacy text'], createdAt: now() });
  await legacy.table('documents').put({ id: 'pdf', blob: new Blob(['legacy']) }); await legacy.table('workspaces').put(w); legacy.close();
  await db.open(); expect((await db.documents.get('pdf'))!.blob.size).toBe(6);
  useApp.setState({ workspace: (await loadWorkspace())!, history: [], future: [], documentEpoch: 0 });
  const image: Screenshot = { assetId: 'asset', sha256: 'b'.repeat(64), size: 5, width: 10, height: 10, rotation: 0, pageIndex: 0, region: { x: 0, y: 0, width: .3, height: .3 } };
  const asset = { id: 'asset', sha256: image.sha256, blob: new Blob(['image'], { type: 'image/png' }) };
  await addScreenshot('pdf', image, asset, 0);
  const id = useApp.getState().workspace.notes[0].id;
  expect(useApp.getState().workspace.notes[0]).toMatchObject({ originalText: '', userNotes: '' });
  deleteNotes([id], true); expect(await db.assets.count()).toBe(1);
  useApp.getState().undo(); await flushSave(); expect(useApp.getState().workspace.notes[0].screenshot).toEqual(image);
  expect((await loadWorkspace())!.notes).toHaveLength(1); expect(await db.assets.count()).toBe(1);
  useApp.getState().redo(); await flushSave();
  useApp.setState({ history: [], future: [] }); await loadWorkspace(); expect(await db.assets.count()).toBe(0);
  await addScreenshot('pdf', image, asset, 99); expect(await db.assets.count()).toBe(0);
  const put = vi.spyOn(db.assets, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'));
  await expect(addScreenshot('pdf', image, asset, 0)).rejects.toThrow('Quota');
  expect(useApp.getState().workspace.notes).toHaveLength(0); expect(await db.assets.count()).toBe(0); put.mockRestore();
  await db.delete();
});
