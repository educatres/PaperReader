import { create } from 'zustand';
import { db, loadSharedState, commitChange, holdWindowStorage } from './lib/db';
import { applyPatches, changesBetween, equal, invertPatches, rebasePatches, type Change, type ConflictDraft, type SyncVersion } from './lib/workspaceChanges';
import { acknowledge, announceDocument, listenWindows, readerWindow, boardWindow, requestedDocument, requestedViewport, routeSource, send, startWindows, windowId } from './lib/windows';
import { emptyWorkspace, now, uid, reasoningEfforts, type Workspace, type Preferences, type Note, type Relation, type Highlight, type Paper, type Point, type Screenshot, type ImageAsset } from './types';

const defaultPreferences: Preferences = { provider: 'openai', models: { openai: 'gpt-6-luna', gemini: '', cgu: 'gpt-6-luna', mercuryapi: '' }, reasoningEffort: 'medium', toolbarCollapsed: false, pdfCollapsed: false, boardCollapsed: false, split: 54, lastPage: {} };
function freshBoardWindow() { try { return boardWindow && sessionStorage.getItem('PaperReader.boardInstance') !== windowId; } catch { return boardWindow; } }
function readView(): Partial<Workspace> { try { return JSON.parse(sessionStorage.getItem('PaperReader.view') || '{}'); } catch { return {}; } }
function saveView(workspace: Workspace) { try { sessionStorage.setItem('PaperReader.view', JSON.stringify({ activeDocumentId: workspace.activeDocumentId, viewport: workspace.viewport })); } catch { /* The view still works in memory. */ } announceDocument(workspace.activeDocumentId); }
function saveReadingPreferences(p: Preferences) { try { sessionStorage.setItem('PaperReader.readingPreferences', JSON.stringify({ lastPage: p.lastPage, split: p.split, toolbarCollapsed: p.toolbarCollapsed, pdfCollapsed: p.pdfCollapsed, boardCollapsed: p.boardCollapsed })); } catch { /* The layout still works in memory. */ } }
function readPreferences(): Preferences {
  try {
    const shared = JSON.parse(localStorage.getItem('PaperReader.preferences') || '{}');
    const p = { ...shared, ...JSON.parse(sessionStorage.getItem('PaperReader.readingPreferences') || '{}') };
    const pdfCollapsed = freshBoardWindow() || p.pdfCollapsed === true;
    return { ...defaultPreferences, provider: ['openai', 'gemini', 'cgu', 'mercuryapi'].includes(p.provider) ? p.provider : 'openai',
      models: { openai: typeof p.models?.openai === 'string' ? p.models.openai : defaultPreferences.models.openai, gemini: typeof p.models?.gemini === 'string' ? p.models.gemini : '', cgu: typeof p.models?.cgu === 'string' ? p.models.cgu : defaultPreferences.models.cgu, mercuryapi: typeof p.models?.mercuryapi === 'string' ? p.models.mercuryapi : '' },
      reasoningEffort: reasoningEfforts.includes(p.reasoningEffort) ? p.reasoningEffort : 'medium', toolbarCollapsed: p.toolbarCollapsed === true,
      pdfCollapsed, boardCollapsed: !pdfCollapsed && p.boardCollapsed === true,
      split: typeof p.split === 'number' ? Math.max(30, Math.min(75, p.split)) : 54, lastPage: p.lastPage || {} };
  } catch { return { ...defaultPreferences, pdfCollapsed: boardWindow }; }
}
let version: SyncVersion = { id: 'default', epoch: '', revision: -1 };
let pending: Change[] = [];
let timer: ReturnType<typeof setTimeout>;
let writeQueue: Promise<void> = Promise.resolve();
function scheduleSave(change: Change) {
  pending.push(change);
  useApp.setState({ saveStatus: 'saving' });
  clearTimeout(timer);
  timer = setTimeout(flushSave, 200);
}
export async function flushSave() {
  clearTimeout(timer);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    try {
      while (pending.length) {
        const change = pending[0];
        // Also supports an edit queued while the initial database read was finishing.
        if (!change.epoch) change.epoch = (await loadSharedState()).version.epoch;
        const result = await commitChange(change); pending.shift();
        if (!result.conflict) {
          const normalized = (item: Change) => item.id === change.id || equal(item.patches, change.patches) ? { ...item, patches: result.applied } : item;
          useApp.setState(s => ({ history: s.history.map(normalized), future: s.future.map(normalized) }));
          for (const queued of pending) for (const patch of queued.patches) {
            const added = change.patches.find(p => p.collection === patch.collection && p.id === patch.id && !p.field && !p.before && p.after);
            const saved = result.applied.find(p => p.collection === patch.collection && p.id === patch.id && !p.field);
            if (added && saved && !patch.field && patch.after === undefined && equal(patch.before, added.after)) patch.before = saved.after;
          }
        }
        acceptShared(result.workspace, result.version);
        if (result.conflict) useApp.setState({ history: [], future: [] });
        send({ type: 'changed' });
      }
      useApp.setState({ saveStatus: 'saved', conflicts: await db.drafts.toArray() });
    } catch {
      useApp.setState({ saveStatus: 'error' });
      toast('本機儲存失敗，可能是空間不足。請先匯出研究封裝備份。', 'error');
    }
  });
  return writeQueue;
}
interface AppState {
  workspace: Workspace; preferences: Preferences; ready: boolean;
  saveStatus: 'saved' | 'saving' | 'error'; history: Change[]; future: Change[];
  conflicts: ConflictDraft[];
  selectedNoteId?: string; focusNoteId?: string; focusHighlightId?: string;
  focusScreenshotNoteId?: string;
  groupSummaryAnchorId?: string;
  sourceFocusSerial: number;
  documentEpoch: number;
  settingsOpen: boolean; helpOpen: boolean; exportOpen: boolean;
  toast?: { id: string; text: string; kind: 'success' | 'error' };
  edit: (change: (draft: Workspace) => void, history?: boolean) => void;
  pref: (change: Partial<Preferences>) => void;
  undo: () => void; redo: () => void;
}
export const useApp = create<AppState>((set, get) => ({
  workspace: emptyWorkspace(), preferences: readPreferences(), ready: false,
  saveStatus: 'saved', history: [], future: [], conflicts: [], sourceFocusSerial: 0, documentEpoch: 0, settingsOpen: false, helpOpen: false, exportOpen: false,
  edit(change, history = true) {
    const old = get().workspace;
    const next = structuredClone(old);
    change(next); next.updatedAt = now();
    set({ workspace: next }); saveView(next);
    submitChange(changesBetween(old, next), history);
  },
  pref(change) {
    const preferences = { ...get().preferences, ...change };
    // Keep one panel visible when the other is hidden or opened separately.
    if (change.boardCollapsed === true) preferences.pdfCollapsed = false;
    if (change.pdfCollapsed === true) preferences.boardCollapsed = false;
    set({ preferences });
    try {
      const saved = JSON.parse(localStorage.getItem('PaperReader.preferences') || '{}');
      const supported = Object.fromEntries(Object.keys(defaultPreferences).filter(key => key in saved).map(key => [key, saved[key]]));
      localStorage.setItem('PaperReader.preferences', JSON.stringify({ ...supported, ...change, pdfCollapsed: preferences.pdfCollapsed, boardCollapsed: preferences.boardCollapsed }));
    } catch { /* memory settings still work */ }
    saveReadingPreferences(preferences);
  },
  undo() {
    const { history, future } = get(); if (!history.length) return;
    const change = history[history.length - 1];
    set({ history: history.slice(0, -1), future: [change, ...future] }); submitChange(invertPatches(change.patches), false, true);
  },
  redo() {
    const { history, future } = get(); if (!future.length) return;
    const change = future[0];
    set({ history: [...history, change], future: future.slice(1) }); submitChange(change.patches, false, true);
  },
}));
function submitChange(patches: Change['patches'], history: boolean, optimistic = false, epoch = version.epoch) {
  if (!patches.length) return;
  const change: Change = { id: uid(), epoch, patches };
  if (optimistic && epoch === version.epoch) { const next = applyPatches(useApp.getState().workspace, patches, false); if (next) useApp.setState({ workspace: next }); }
  if (history) useApp.setState(s => ({ history: [...s.history.slice(-39), change], future: [] }));
  scheduleSave(change);
}
function acceptShared(workspace: Workspace, incoming: SyncVersion) {
  if (incoming.revision < version.revision) return;
  const reset = !!version.epoch && version.epoch !== incoming.epoch;
  version = incoming;
  let next = workspace;
  for (const change of pending) if (change.epoch === version.epoch) next = applyPatches(next, change.patches, false) || next;
  const local = useApp.getState().workspace;
  next = { ...next, activeDocumentId: next.documents.some(d => d.id === local.activeDocumentId) ? local.activeDocumentId : undefined, viewport: local.viewport };
  useApp.setState(s => ({ workspace: next, ...(reset ? { documentEpoch: s.documentEpoch + 1, history: [], future: [], focusHighlightId: undefined, focusScreenshotNoteId: undefined } : {}) }));
  if (reset) window.dispatchEvent(new Event('paperreader-reset'));
  saveView(next);
}
export async function refreshShared() {
  const state = await loadSharedState(); acceptShared(state.workspace, state.version);
  useApp.setState({ conflicts: await db.drafts.toArray() });
}
function refreshInBackground(after?: () => void) {
  void refreshShared().then(after).catch(() => toast('暫時無法讀取共用資料，切回視窗後會再同步。', 'error'));
}
export function getWorkspaceEpoch() { return version.epoch; }
let initialized: Promise<void> | undefined;
export function initialize() { return initialized ||= initializeOnce(); }
async function initializeOnce() {
  try {
    await holdWindowStorage();
    const state = await loadSharedState(); version = state.version;
    const view = readView(); const active = requestedDocument || view.activeDocumentId || state.workspace.activeDocumentId || state.workspace.documents[0]?.id;
    const workspace = { ...state.workspace, activeDocumentId: state.workspace.documents.some(d => d.id === active) ? active : undefined, viewport: freshBoardWindow() && requestedViewport || view.viewport || state.workspace.viewport };
    try { if (boardWindow) sessionStorage.setItem('PaperReader.boardInstance', windowId); } catch { /* Reading still works without saved views. */ }
    useApp.setState({ workspace, conflicts: await db.drafts.toArray() }); saveView(workspace);
    saveReadingPreferences(useApp.getState().preferences);
    listenWindows(message => {
      if (message.type === 'changed') refreshInBackground();
      if (message.type === 'files') refreshInBackground(() => { useApp.setState(s => ({ documentEpoch: s.documentEpoch + 1 })); window.dispatchEvent(new Event('paperreader-files')); });
      if (message.type === 'source' && message.to === windowId) refreshInBackground(() => {
        const note = useApp.getState().workspace.notes.find(n => n.id === message.note.id);
        if (note) { focusLocalSource(note); window.focus(); acknowledge(message.from, message.request); }
      });
      if (message.type === 'note' && message.to === windowId && !readerWindow && !useApp.getState().preferences.boardCollapsed) useApp.setState({ selectedNoteId: message.noteId, focusNoteId: message.noteId });
    });
    startWindows();
    window.addEventListener('focus', () => refreshInBackground());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshInBackground(); });
    window.addEventListener('pageshow', event => { if (event.persisted) void holdWindowStorage(false).then(() => refreshInBackground()).catch(() => toast('無法重新連接本機資料庫，請先備份研究資料。', 'error')); });
    // Recover only tasks whose owning window no longer holds the execution lock.
    if (!readerWindow) await recoverSummaryJobs();
    await refreshShared();
  }
  catch { toast('無法開啟本機資料庫。請允許網站儲存空間，再重新整理。', 'error'); }
  finally { useApp.setState({ ready: true }); }
}
export function notifyDocumentFiles() { send({ type: 'files' }); }
export async function recoverSummaryJobs() {
  if (!navigator.locks) return;
  await navigator.locks.request('PaperReader.full-summary', { ifAvailable: true }, async lock => {
    if (!lock) return;
    await refreshShared();
    useApp.getState().edit(w => { w.jobs.forEach(j => { if (j.status === 'running') j.status = 'paused'; }); }, false);
    await flushSave();
  });
}
export async function resolveConflict(draft: ConflictDraft, keepMine: boolean) {
  await refreshShared();
  if (keepMine) {
    if (draft.epoch !== version.epoch) { toast('研究空間已更換，請下載草稿保留內容。', 'error'); return; }
    const patches = rebasePatches(useApp.getState().workspace, draft.patches);
    if (!patches || !applyPatches(useApp.getState().workspace, patches)) { toast('來源已移除，請下載草稿保留內容。', 'error'); return; }
    submitChange(patches, true, true); await flushSave();
    if (useApp.getState().saveStatus === 'error') return;
  }
  await db.drafts.delete(draft.id); await refreshShared(); send({ type: 'changed' });
}
export async function replaceWorkspace(workspace: Workspace, documents: { id: string; blob: Blob }[] = [], assets: ImageAsset[] = [], clear = false) {
  await flushSave();
  await db.transaction('rw', db.workspaces, db.documents, db.assets, db.sync, db.drafts, async () => {
    const saved = await db.sync.get('default');
    if (clear) { await db.documents.clear(); await db.assets.clear(); await db.drafts.clear(); }
    if (documents.length) await db.documents.bulkPut(documents);
    if (assets.length) await db.assets.bulkPut(assets);
    await db.workspaces.put(workspace);
    await db.sync.put({ id: 'default', epoch: uid(), revision: (saved?.revision || 0) + 1 });
  });
  useApp.setState(s => ({ workspace, documentEpoch: s.documentEpoch + 1, history: [], future: [], selectedNoteId: undefined, focusNoteId: undefined, focusHighlightId: undefined, focusScreenshotNoteId: undefined }));
  await refreshShared(); send({ type: 'changed' });
}
let toastTimer: ReturnType<typeof setTimeout>;
export function toast(text: string, kind: 'success' | 'error' = 'success') {
  clearTimeout(toastTimer);
  useApp.setState({ toast: { id: uid(), text, kind } });
  toastTimer = setTimeout(() => useApp.setState({ toast: undefined }), kind === 'error' ? 8000 : 3500);
}
export function nextPosition(center?: Point): Point {
  const { workspace } = useApp.getState();
  const visible = workspace.notes.filter(n => !n.hidden);
  const vp = workspace.viewport;
  const origin = center || { x: (160 - vp.x) / vp.zoom, y: (90 - vp.y) / vp.zoom };
  for (let i = 0; i < 1000; i++) {
    const candidate = { x: origin.x + (i % 3) * 365, y: origin.y + Math.floor(i / 3) * 380 };
    if (!visible.some(n => Math.abs(n.position.x - candidate.x) < n.width + 30 && Math.abs(n.position.y - candidate.y) < 350)) return candidate;
  }
  return { x: origin.x, y: visible.length * 400 };
}
export function createNote(partial: Partial<Note> = {}) {
  const note: Note = { id: uid(), type: 'manual-note', title: '研究靈感', originalText: '', userNotes: '', tags: [],
    position: nextPosition(), width: 320, collapsed: false, hidden: false, color: 'yellow', updatedAt: now(), ...partial };
  useApp.getState().edit(w => { w.notes.push(note); });
  useApp.setState({ selectedNoteId: note.id, focusNoteId: note.id });
  return note;
}
export function patchNote(id: string, patch: Partial<Note>) {
  useApp.getState().edit(w => { const n = w.notes.find(n => n.id === id); if (n) Object.assign(n, patch, { updatedAt: now() }); });
}
function entityPatches<T extends Note | Relation>(collection: 'notes' | 'edges', base: T, patch: Partial<T>) {
  const before = structuredClone(useApp.getState().workspace);
  const records = before[collection] as (Note | Relation)[];
  const index = records.findIndex(item => item.id === base.id);
  if (index >= 0) records[index] = base; else records.push(base);
  const after = structuredClone(before);
  const target = (after[collection] as (Note | Relation)[]).find(item => item.id === base.id)!;
  Object.assign(target, patch);
  return changesBetween(before, after);
}
export function saveEntityDraft<T extends Note | Relation>(collection: 'notes' | 'edges', base: T, patch: Partial<T>, epoch = version.epoch) {
  submitChange(entityPatches(collection, base, patch), true, true, epoch);
}
export async function preserveEntityDraft<T extends Note | Relation>(collection: 'notes' | 'edges', base: T, patch: Partial<T>, epoch = version.epoch) {
  const patches = entityPatches(collection, base, patch); if (!patches.length) return;
  try {
    await db.drafts.put({ id: uid(), epoch, patches, createdAt: now(), reason: '編輯中的來源已被其他視窗移除或隱藏，已保留尚未儲存的草稿。' });
    await refreshShared(); send({ type: 'changed' });
  } catch { toast('草稿儲存失敗，請先備份研究資料。', 'error'); }
}
export function addHighlight(highlight: Highlight) {
  const note: Note = { id: highlight.noteId, documentId: highlight.documentId, highlightId: highlight.id, type: 'highlight-note',
    title: highlight.normalizedText.slice(0, 48), originalText: highlight.rawText || highlight.selectedText, userNotes: '', tags: [],
    position: nextPosition(), width: 320, collapsed: false, hidden: false, color: highlight.color, updatedAt: now() };
  useApp.getState().edit(w => { w.highlights.push(highlight); w.notes.push(note); });
  useApp.setState({ selectedNoteId: note.id, focusNoteId: note.id });
  toast('已新增便條，靈感已留在白板上');
}
function focusLocalSource(note: Note) {
  if (!note.documentId) return;
  useApp.getState().edit(w => { w.activeDocumentId = note.documentId; }, false);
  useApp.setState(s => ({ focusHighlightId: note.highlightId, focusScreenshotNoteId: note.screenshot ? note.id : undefined, sourceFocusSerial: s.sourceFocusSerial + 1, selectedNoteId: note.id }));
}
export async function focusSource(note: Note) {
  if (!note.documentId) return;
  if (!readerWindow && await routeSource(note)) { toast('已在閱讀視窗定位原文'); return; }
  useApp.getState().pref({ pdfCollapsed: false }); focusLocalSource(note);
  window.dispatchEvent(new Event('paperreader-show-pdf'));
}
export async function addScreenshot(documentId: string, screenshot: Screenshot, asset: ImageAsset, epoch: number) {
  const valid = () => useApp.getState().documentEpoch === epoch && useApp.getState().workspace.documents.some(d => d.id === documentId);
  if (!valid()) return;
  // Persist the Blob before adding a reference; quota failures create no blank card.
  await db.assets.put(asset);
  if (!valid()) { await db.assets.delete(asset.id); return; }
  createNote({ type: 'screenshot-note', documentId, screenshot, title: `PDF 截圖 · p. ${screenshot.pageIndex + 1}`, originalText: '', userNotes: '', color: 'blue' });
  await flushSave();
  if (useApp.getState().saveStatus !== 'error') toast('截圖已加入白板；可自行輸入或貼上文字');
}
export async function addPaper(paper: Paper, blob: Blob) {
  await db.documents.put({ id: paper.id, blob });
  // Documents remain in storage when undone, so undo/redo can restore the reference safely.
  useApp.getState().edit(w => { w.documents.push(paper); w.activeDocumentId = paper.id; });
  await flushSave();
}
export function deleteNotes(ids: string[], removeHighlight: boolean) {
  useApp.getState().edit(w => {
    if (removeHighlight) {
      w.highlights = w.highlights.filter(h => !ids.includes(h.noteId));
      w.notes = w.notes.filter(n => !ids.includes(n.id));
      w.edges = w.edges.filter(e => !ids.includes(e.source) && !ids.includes(e.target));
    } else w.notes.forEach(n => { if (ids.includes(n.id)) n.hidden = true; });
  });
  useApp.setState({ selectedNoteId: undefined });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushSave(); });
window.addEventListener('pagehide', event => { void flushSave(); if (event.persisted) useApp.setState({ history: [], future: [] }); });
window.addEventListener('beforeunload', e => { if (pending.length || useApp.getState().saveStatus !== 'saved') { void flushSave(); e.preventDefault(); } });
