import { create } from 'zustand';
import { db, loadSharedState, commitChange, holdWindowStorage, projectDrafts, listProjects, writeProject, projectTitle, ProjectMissingError } from './lib/db';
import { applyPatches, changesBetween, equal, invertPatches, rebasePatches, type Change, type ConflictDraft, type SyncVersion } from './lib/workspaceChanges';
import { acknowledge, announceDocument, listenWindows, readerWindow, boardWindow, routeSource, send, startWindows, windowId, parseRoute, applyRoute, projectURL, type ProjectRoute } from './lib/windows';
import { captureContext, isCurrentContext, getProjectId, requireProjectId, changeProjectContext, projectStorageKey, projectLock, hasBusyOperation, saveOpenEditors, snapshotOpenEditors, stopOwnedTasks } from './lib/projectContext';
import { emptyWorkspace, now, uid, providers, reasoningEfforts, type Workspace, type Preferences, type Note, type Relation, type Highlight, type Paper, type Point, type Screenshot, type ImageAsset, type ProjectView } from './types';
import { erasePdfHighlight, erasePdfTranslation } from './lib/pdfAnnotations';

const defaultPreferences: Preferences = { provider: 'openai', models: { openai: 'gpt-6-luna', gemini: '', cgu: 'gpt-6-luna', mercuryapi: '', grok: '' }, reasoningEffort: 'medium', toolbarCollapsed: false, pdfCollapsed: false, boardCollapsed: false, split: 54, lastPage: {} };
const viewKind = (route: ProjectRoute) => route.view === 'projects' ? 'main' : route.view;
function sessionValue(key: string) { try { return JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { return {}; } }
function localViewKey(name: string, id = getProjectId(), route = useApp.getState().route) { return projectStorageKey(name + '.' + viewKind(route), id); }
function readPreferences(id?: string, route: ProjectRoute = parseRoute(), recent?: Partial<Preferences>): Preferences {
  const shared = (() => { try { return JSON.parse(localStorage.getItem('PaperReader.preferences') || '{}'); } catch { return {}; } })();
  const legacy = id === 'default' && !recent ? { ...shared, ...sessionValue('PaperReader.readingPreferences') } : {};
  const p = { ...recent, ...legacy, ...(id ? sessionValue(projectStorageKey('readingPreferences.' + viewKind(route), id)) : {}) };
  const pdfCollapsed = p.pdfCollapsed === true;
  return { ...defaultPreferences, provider: providers.includes(shared.provider) ? shared.provider : 'openai',
    models: { ...defaultPreferences.models, ...Object.fromEntries(providers.filter(provider => typeof shared.models?.[provider] === 'string').map(provider => [provider, shared.models[provider]])) },
    reasoningEffort: reasoningEfforts.includes(shared.reasoningEffort) ? shared.reasoningEffort : 'medium',
    toolbarCollapsed: p.toolbarCollapsed === true, pdfCollapsed, boardCollapsed: !pdfCollapsed && p.boardCollapsed === true,
    split: typeof p.split === 'number' ? Math.max(30, Math.min(75, p.split)) : 54, lastPage: p.lastPage || {} };
}
function readingPreferences(p: Preferences): Partial<Preferences> {
  return { lastPage: p.lastPage, split: p.split, toolbarCollapsed: p.toolbarCollapsed, pdfCollapsed: p.pdfCollapsed, boardCollapsed: p.boardCollapsed };
}
let viewTimer: ReturnType<typeof setTimeout>;
let viewQueue: Promise<void> = Promise.resolve();
function scheduleView() { clearTimeout(viewTimer); if (getProjectId()) viewTimer = setTimeout(() => { void flushProjectView().catch(() => {}); }, 250); }
function saveView(workspace: Workspace) {
  if (workspace.id !== getProjectId()) return;
  try { sessionStorage.setItem(localViewKey('view'), JSON.stringify({ activeDocumentId: workspace.activeDocumentId, viewport: workspace.viewport })); } catch { /* Memory remains usable. */ }
  announceDocument(workspace.activeDocumentId); scheduleView();
}
function saveReadingPreferences(p: Preferences) {
  if (!getProjectId()) return;
  try { sessionStorage.setItem(localViewKey('readingPreferences'), JSON.stringify(readingPreferences(p))); } catch { /* Memory remains usable. */ }
  scheduleView();
}
export function savePdfPreference() { scheduleView(); }
export async function flushProjectView() {
  clearTimeout(viewTimer);
  const id = getProjectId(); if (!id) return;
  const { workspace, preferences, route } = useApp.getState(); const epoch = version.epoch;
  const pdf: Record<string, unknown> = {};
  try { const prefix = projectStorageKey('pdf.', id); for (let i = 0; i < sessionStorage.length; i++) { const key = sessionStorage.key(i); if (key?.startsWith(prefix)) pdf[key.slice(prefix.length)] = JSON.parse(sessionStorage.getItem(key) || 'null'); } } catch { /* Optional PDF preferences. */ }
  const view: ProjectView = { projectId: id, kind: viewKind(route), activeDocumentId: workspace.activeDocumentId, viewport: workspace.viewport, preferences: readingPreferences(preferences), pdf };
  viewQueue = viewQueue.catch(() => {}).then(() => db.transaction('rw', db.views, db.sync, async () => {
    const saved = await db.sync.get(id);
    if (saved?.state === 'active' && saved.epoch === epoch) await db.views.put(view);
  }));
  await viewQueue;
}
let version: SyncVersion = { id: '', epoch: '', revision: -1 };
let pending: Change[] = [];
let pendingDrafts: ConflictDraft[] = [];
let timer: ReturnType<typeof setTimeout>;
let writeQueue: Promise<void> = Promise.resolve();
function scheduleSave(change: Change) {
  pending.push(change); useApp.setState({ saveStatus: 'saving' }); clearTimeout(timer); timer = setTimeout(flushSave, 200);
}
export async function flushSave(): Promise<boolean> {
  clearTimeout(timer);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    try {
      while (pending.length) {
        const change = pending[0];
        if (!change.epoch) change.epoch = (await loadSharedState(change.projectId)).version.epoch;
        const context = captureContext(); const result = await commitChange(change); pending.shift();
        if (isCurrentContext(context) && change.projectId === getProjectId()) {
          if (!result.conflict) {
            const normalized = (item: Change) => item.id === change.id || equal(item.patches, change.patches) ? { ...item, patches: result.applied } : item;
            useApp.setState(s => ({ history: s.history.map(normalized), future: s.future.map(normalized) }));
            for (const queued of pending) for (const patch of queued.patches) {
              if (queued.projectId !== change.projectId) continue;
              const added = change.patches.find(p => p.collection === patch.collection && p.id === patch.id && !p.field && !p.before && p.after);
              const saved = result.applied.find(p => p.collection === patch.collection && p.id === patch.id && !p.field);
              if (added && saved && !patch.field && patch.after === undefined && equal(patch.before, added.after)) patch.before = saved.after;
            }
          }
          acceptShared(result.workspace, result.version);
          if (result.conflict) useApp.setState({ history: [], future: [] });
        }
        notifyProjectsChanged(change.projectId);
      }
      while (pendingDrafts.length) {
        const draft = pendingDrafts[0];
        await db.transaction('rw', db.sync, db.drafts, async () => {
          if ((await db.sync.get(draft.projectId))?.state !== 'active') throw new ProjectMissingError();
          await db.drafts.put(draft);
        });
        pendingDrafts.shift(); notifyProjectsChanged(draft.projectId);
      }
      const context = captureContext(); const conflicts = context.projectId ? await projectDrafts(context.projectId) : [];
      if (isCurrentContext(context)) useApp.setState({ saveStatus: 'saved', conflicts });
    } catch (error) {
      if (error instanceof ProjectMissingError && (pending[0]?.projectId === getProjectId() || pendingDrafts[0]?.projectId === getProjectId())) markProjectMissing();
      else { useApp.setState({ saveStatus: 'error' }); toast('本機儲存失敗，可能是空間不足。請先匯出研究封裝備份。', 'error'); }
    }
  });
  await writeQueue;
  return !pending.length && !pendingDrafts.length && useApp.getState().saveStatus === 'saved';
}
interface AppState {
  workspace: Workspace; preferences: Preferences; ready: boolean;
  route: ProjectRoute; switching: boolean; missingProject: boolean; initializationError?: string;
  projectsRevision: number; deletedDraft?: unknown;
  persistedPdfTranslations: Workspace['pdfTranslations'];
  saveStatus: 'saved' | 'saving' | 'error'; history: Change[]; future: Change[];
  conflicts: ConflictDraft[];
  selectedNoteId?: string; focusNoteId?: string; focusHighlightId?: string; focusScreenshotNoteId?: string;
  groupSummaryAnchorId?: string; sourceFocusSerial: number; documentEpoch: number;
  settingsOpen: boolean; helpOpen: boolean; exportOpen: boolean;
  toast?: { id: string; text: string; kind: 'success' | 'error' };
  edit: (change: (draft: Workspace) => void, history?: boolean) => void;
  pref: (change: Partial<Preferences>) => void; undo: () => void; redo: () => void;
}
export const useApp = create<AppState>((set, get) => ({
  workspace: emptyWorkspace('__none__'), preferences: readPreferences(), ready: false, route: parseRoute(),
  switching: false, missingProject: false, projectsRevision: 0, persistedPdfTranslations: [],
  saveStatus: 'saved', history: [], future: [], conflicts: [], sourceFocusSerial: 0, documentEpoch: 0,
  settingsOpen: false, helpOpen: false, exportOpen: false,
  edit(change, history = true) {
    const old = get().workspace;
    if (!getProjectId() || get().missingProject || old.id !== getProjectId()) return;
    const next = structuredClone(old); change(next);
    const patches = changesBetween(old, next);
    next.updatedAt = patches.length ? now() : old.updatedAt;
    set({ workspace: next }); saveView(next); submitChange(patches, history);
  },
  pref(change) {
    const preferences = { ...get().preferences, ...change };
    if (change.boardCollapsed === true) preferences.pdfCollapsed = false;
    if (change.pdfCollapsed === true) preferences.boardCollapsed = false;
    set({ preferences });
    try { localStorage.setItem('PaperReader.preferences', JSON.stringify({ provider: preferences.provider, models: preferences.models, reasoningEffort: preferences.reasoningEffort })); } catch { /* Memory remains usable. */ }
    saveReadingPreferences(preferences);
  },
  undo() {
    const { history, future } = get(); if (!history.length || get().switching) return;
    const change = history[history.length - 1]; set({ history: history.slice(0, -1), future: [change, ...future] });
    submitChange(invertPatches(change.patches), false, true);
  },
  redo() {
    const { history, future } = get(); if (!future.length || get().switching) return;
    const change = future[0]; set({ history: [...history, change], future: future.slice(1) });
    submitChange(change.patches, false, true);
  },
}));
function submitChange(patches: Change['patches'], history: boolean, optimistic = false, epoch = version.epoch, projectId = getProjectId()) {
  if (!patches.length || !projectId) return;
  const change: Change = { id: uid(), projectId, epoch, patches };
  if (optimistic && projectId === getProjectId() && epoch === version.epoch) { const next = applyPatches(useApp.getState().workspace, patches, false); if (next) useApp.setState({ workspace: next }); }
  if (history && projectId === getProjectId()) useApp.setState(s => ({ history: [...s.history.slice(-39), change], future: [] }));
  scheduleSave(change);
}
function acceptShared(workspace: Workspace, incoming: SyncVersion) {
  if (workspace.id !== getProjectId() || incoming.revision < version.revision) return;
  const reset = !!version.epoch && version.epoch !== incoming.epoch; version = incoming;
  let next = workspace;
  for (const change of pending) if (change.projectId === workspace.id && change.epoch === version.epoch) next = applyPatches(next, change.patches, false) || next;
  const local = useApp.getState().workspace;
  next = { ...next, activeDocumentId: next.documents.some(d => d.id === local.activeDocumentId) ? local.activeDocumentId : next.documents[0]?.id, viewport: local.viewport };
  if (reset) { changeProjectContext(workspace.id); window.dispatchEvent(new Event('paperreader-reset')); }
  useApp.setState(s => ({ workspace: next, persistedPdfTranslations: workspace.pdfTranslations,
    ...(reset ? { documentEpoch: s.documentEpoch + 1, history: [], future: [], focusHighlightId: undefined, focusScreenshotNoteId: undefined } : {}) }));
}
function markProjectMissing() {
  if (useApp.getState().missingProject) return;
  const hadProject = !!getProjectId();
  const snapshot = localDraftSnapshot();
  pending = []; pendingDrafts = []; changeProjectContext(undefined); window.dispatchEvent(new Event('paperreader-reset'));
  useApp.setState(s => ({ missingProject: true, deletedDraft: hadProject ? snapshot : undefined, documentEpoch: s.documentEpoch + 1, history: [], future: [], saveStatus: 'error' }));
  announceDocument(undefined);
}
export function localDraftSnapshot() {
  return { workspace: useApp.getState().workspace, pending: [...pending], pendingDrafts: [...pendingDrafts], editors: snapshotOpenEditors() };
}
export async function refreshShared() {
  const context = captureContext(); if (!context.projectId) return;
  try {
    const state = await loadSharedState(context.projectId); const conflicts = await projectDrafts(context.projectId);
    if (!isCurrentContext(context)) return;
    acceptShared(state.workspace, state.version); useApp.setState({ conflicts });
  } catch (error) {
    if (!isCurrentContext(context)) return;
    if (error instanceof ProjectMissingError) markProjectMissing(); else throw error;
  }
}
function refreshInBackground(after?: () => void) {
  const context = captureContext();
  void refreshShared().then(() => { if (isCurrentContext(context)) after?.(); }).catch(() => { if (isCurrentContext(context)) toast('暫時無法讀取共用資料，切回視窗後會再同步。', 'error'); });
}
export function getWorkspaceEpoch() { return version.epoch; }
export function saveProjectName(before: string, after: string, epoch: string, projectId: string) {
  after = projectTitle(after);
  if (before !== after) submitChange([{ collection: 'workspace', field: 'title', before, after }], true, true, epoch, projectId);
}
export function notifyProjectsChanged(projectId?: string) { useApp.setState(s => ({ projectsRevision: s.projectsRevision + 1 })); send({ type: 'changed' }, projectId); }
let initialized: Promise<void> | undefined;
let listenersInstalled = false;
let currentHistoryIndex = 0;
let restoringHistory = false;
async function activateRoute(route: ProjectRoute, reset = false) {
  let state: Awaited<ReturnType<typeof loadSharedState>> | undefined; let conflicts: ConflictDraft[] = []; let recent: ProjectView | undefined;
  if (route.projectId) {
    [state, conflicts, recent] = await Promise.all([loadSharedState(route.projectId), projectDrafts(route.projectId), db.views.get([route.projectId, viewKind(route)])]);
  }
  if (reset) window.dispatchEvent(new Event('paperreader-reset'));
  changeProjectContext(route.projectId); applyRoute(route);
  version = state?.version || { id: '', epoch: '', revision: -1 };
  if (route.projectId === 'default') {
    try {
      const marker = projectStorageKey('legacyViewMigrated.' + viewKind(route));
      if (!sessionStorage.getItem(marker)) {
        // Each upgraded window keeps its own legacy view, even if another
        // window already saved the project's recent defaults in IndexedDB.
        for (const name of ['view', 'readingPreferences']) {
          const old = sessionStorage.getItem('PaperReader.' + name);
          const target = projectStorageKey(name + '.' + viewKind(route));
          if (old && !sessionStorage.getItem(target)) sessionStorage.setItem(target, old);
        }
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith('PaperReader.pdf.')) {
            const target = projectStorageKey(key.slice('PaperReader.'.length));
            if (!sessionStorage.getItem(target)) sessionStorage.setItem(target, sessionStorage.getItem(key)!);
          }
        }
        const oldBoard = sessionStorage.getItem('PaperReader.boardInstance');
        if (oldBoard && !sessionStorage.getItem(projectStorageKey('boardInstance'))) sessionStorage.setItem(projectStorageKey('boardInstance'), oldBoard);
        sessionStorage.setItem(marker, 'yes');
      }
    } catch { /* Legacy views are optional; project data stays intact. */ }
  }
  const preferences = readPreferences(route.projectId, route, recent?.preferences);
  const own = route.projectId ? sessionValue(projectStorageKey('view.' + viewKind(route), route.projectId)) : {};
  const legacy = route.projectId === 'default' && !Object.keys(own).length && !recent ? sessionValue('PaperReader.view') : {};
  const view = { ...recent, ...legacy, ...own };
  const base = state?.workspace || emptyWorkspace('__none__');
  const active = route.documentId || view.activeDocumentId || base.activeDocumentId || base.documents[0]?.id;
  const freshBoard = boardWindow && sessionValue(projectStorageKey('boardInstance')).id !== windowId;
  if (freshBoard) { preferences.pdfCollapsed = true; preferences.boardCollapsed = false; }
  const workspace = { ...base, activeDocumentId: base.documents.some(d => d.id === active) ? active : base.documents[0]?.id,
    viewport: freshBoard && route.viewport || view.viewport || base.viewport };
  try {
    if (boardWindow) sessionStorage.setItem(projectStorageKey('boardInstance'), JSON.stringify({ id: windowId }));
    if (recent?.pdf) for (const [key, value] of Object.entries(recent.pdf)) { const storageKey = projectStorageKey('pdf.' + key); if (!sessionStorage.getItem(storageKey)) sessionStorage.setItem(storageKey, JSON.stringify(value)); }
  } catch { /* Memory remains usable. */ }
  useApp.setState(s => ({ route, workspace, preferences, conflicts, persistedPdfTranslations: workspace.pdfTranslations, missingProject: false, deletedDraft: undefined,
    documentEpoch: s.documentEpoch + 1, history: [], future: [], saveStatus: 'saved', selectedNoteId: undefined, focusNoteId: undefined,
    focusHighlightId: undefined, focusScreenshotNoteId: undefined, groupSummaryAnchorId: undefined, settingsOpen: false, helpOpen: false, exportOpen: false }));
  saveView(workspace); saveReadingPreferences(preferences);
  if (route.projectId) {
    // Activation has succeeded. Optional recovery failures must not roll the URL
    // back to a different project or destroy the view we just mounted.
    try {
      await db.projects.update(route.projectId, { lastOpenedAt: now() });
      if (!readerWindow) await recoverSummaryJobs();
      if (workspace.pdfTranslationJobs.some(j => j.status === 'running')) await (await import('./lib/pdfTranslation')).recoverPdfTranslationJobs();
      await refreshShared();
    } catch { toast('專案已開啟，但任務狀態未能更新；請重試儲存。', 'error'); }
  }
}
export function initialize() { return initialized ||= initializeOnce(); }
async function initializeOnce() {
  try {
    await db.open(); await holdWindowStorage();
    if (!listenersInstalled) {
    listenersInstalled = true;
    listenWindows(message => {
      if (message.type === 'changed') useApp.setState(s => ({ projectsRevision: s.projectsRevision + 1 }));
      if (message.projectId !== getProjectId() || !getProjectId()) return;
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
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { refreshInBackground(); useApp.setState(s => ({ projectsRevision: s.projectsRevision + 1 })); } });
    window.addEventListener('paperreader-database-upgraded', () => {
      window.dispatchEvent(new Event('paperreader-reset')); changeProjectContext(undefined);
      useApp.setState({ saveStatus: 'error', initializationError: '研究資料已由另一視窗升級。請重新整理此視窗後再編輯。' });
    });
    window.addEventListener('pageshow', event => { if (event.persisted) void holdWindowStorage(false).then(() => refreshInBackground()).catch(() => {}); });
    window.history.replaceState({ paperReaderIndex: 0 }, '', location.href);
    window.addEventListener('popstate', () => {
      if (restoringHistory) { restoringHistory = false; return; }
      const targetIndex = window.history.state?.paperReaderIndex ?? 0; const route = parseRoute();
      void navigateRoute(route, false).then(ok => {
        if (ok) currentHistoryIndex = targetIndex;
        else if (targetIndex !== currentHistoryIndex) { restoringHistory = true; window.history.go(currentHistoryIndex - targetIndex); }
        else window.history.replaceState({ paperReaderIndex: currentHistoryIndex }, '', projectURL(useApp.getState().route.projectId));
      });
    });
    }
    const route = parseRoute();
    try { await activateRoute(route); } catch (error) { if (error instanceof ProjectMissingError) { useApp.setState({ route }); markProjectMissing(); } else throw error; }
    await listProjects(); useApp.setState({ initializationError: undefined });
  } catch { useApp.setState({ initializationError: '無法開啟本機資料庫。請允許網站儲存空間，再重試。' }); }
  finally { useApp.setState({ ready: true }); }
}
export function retryInitialize() { initialized = undefined; useApp.setState({ ready: false }); return initialize(); }
async function navigateRoute(route: ProjectRoute, push = true): Promise<boolean> {
  if (useApp.getState().switching || hasBusyOperation()) { toast('處理完成後即可切換專案。', 'error'); return false; }
  useApp.setState({ switching: true });
  try {
    if (route.projectId) await loadSharedState(route.projectId);
    if (getProjectId()) {
      await saveOpenEditors(); await stopOwnedTasks();
      if (!await flushSave()) throw new Error('資料尚未保存，請重試儲存或先下載備份。');
      await flushProjectView();
    }
    await activateRoute(route, true);
    if (push) { currentHistoryIndex++; window.history.pushState({ paperReaderIndex: currentHistoryIndex }, '', projectURL(route.projectId)); }
    return true;
  } catch (error) { toast((error as Error).message, 'error'); return false; }
  finally { useApp.setState({ switching: false }); }
}
export function navigateToProject(projectId?: string) { return navigateRoute({ projectId, view: projectId ? 'main' : 'projects' }); }
export function notifyDocumentFiles() { send({ type: 'files' }); }
export async function recoverSummaryJobs() {
  if (!navigator.locks || !getProjectId()) return;
  const context = captureContext();
  await navigator.locks.request(projectLock('full-summary'), { ifAvailable: true }, async lock => {
    if (!lock || !isCurrentContext(context)) return;
    await refreshShared(); if (!isCurrentContext(context)) return;
    useApp.getState().edit(w => { w.jobs.forEach(j => { if (j.status === 'running') j.status = 'paused'; }); }, false); await flushSave();
  });
}
export async function resolveConflict(draft: ConflictDraft, keepMine: boolean) {
  if (draft.projectId !== getProjectId()) return;
  await refreshShared();
  if (keepMine) {
    if (draft.epoch !== version.epoch) { toast('研究空間已更換，請下載草稿保留內容。', 'error'); return; }
    const patches = rebasePatches(useApp.getState().workspace, draft.patches);
    if (!patches || !applyPatches(useApp.getState().workspace, patches)) { toast('來源已移除，請下載草稿保留內容。', 'error'); return; }
    submitChange(patches, true, true); if (!await flushSave()) return;
  }
  await db.drafts.delete([draft.projectId, draft.id]); await refreshShared(); notifyProjectsChanged(draft.projectId);
}
export async function replaceWorkspace(workspace: Workspace, documents: { id: string; blob: Blob }[] = [], assets: ImageAsset[] = [], clear = false) {
  const projectId = requireProjectId();
  await saveOpenEditors(); await stopOwnedTasks();
  if (!await flushSave()) throw new Error('目前專案尚未保存。');
  await writeProject({ ...workspace, id: projectId }, documents, assets, clear ? 'clear' : 'replace');
  await refreshShared();
  const activeDocumentId = workspace.documents.some(d => d.id === workspace.activeDocumentId) ? workspace.activeDocumentId : workspace.documents[0]?.id;
  useApp.setState(s => ({ workspace: { ...s.workspace, activeDocumentId, viewport: workspace.viewport }, preferences: { ...s.preferences, lastPage: {} } }));
  try {
    const prefix = projectStorageKey('pdf.', projectId);
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)) sessionStorage.removeItem(key);
  } catch { /* Optional view state. */ }
  saveView(useApp.getState().workspace); saveReadingPreferences(useApp.getState().preferences);
  notifyProjectsChanged(projectId);
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
export function saveEntityDraft<T extends Note | Relation>(collection: 'notes' | 'edges', base: T, patch: Partial<T>, epoch = version.epoch, projectId = getProjectId()) {
  submitChange(entityPatches(collection, base, patch), true, true, epoch, projectId);
}
export async function preserveEntityDraft<T extends Note | Relation>(collection: 'notes' | 'edges', base: T, patch: Partial<T>, epoch = version.epoch, projectId = getProjectId()) {
  if (!projectId || projectId !== getProjectId()) return;
  const patches = entityPatches(collection, base, patch); if (!patches.length) return;
  // Keep the draft in the same awaited/retryable queue as normal saves. An
  // unmounted editor must not lose its text when the draft transaction fails.
  pendingDrafts.push({ id: uid(), projectId, epoch, patches, createdAt: now(), reason: '編輯中的來源已被其他視窗移除或隱藏，已保留尚未儲存的草稿。' });
  useApp.setState({ saveStatus: 'saving' });
  await flushSave();
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
  const context = captureContext();
  if (!readerWindow && await routeSource(note)) { toast('已在閱讀視窗定位原文'); return; }
  if (!isCurrentContext(context)) return;
  useApp.getState().pref({ pdfCollapsed: false }); focusLocalSource(note);
  window.dispatchEvent(new Event('paperreader-show-pdf'));
}
export async function addScreenshot(documentId: string, screenshot: Screenshot, asset: ImageAsset, epoch: number) {
  const projectId = requireProjectId(); const context = captureContext();
  const valid = () => isCurrentContext(context) && useApp.getState().documentEpoch === epoch && useApp.getState().workspace.documents.some(d => d.id === documentId);
  if (!valid()) return;
  // Persist the Blob before adding a reference; quota failures create no blank card.
  await db.transaction('rw', db.assets, db.sync, async () => {
    if ((await db.sync.get(projectId))?.state !== 'active' || !valid()) throw new ProjectMissingError();
    await db.assets.put({ ...asset, projectId });
  });
  if (!valid()) { await db.assets.delete([projectId, asset.id]); return; }
  createNote({ type: 'screenshot-note', documentId, screenshot, title: `PDF 截圖 · p. ${screenshot.pageIndex + 1}`, originalText: '', userNotes: '', color: 'blue' });
  await flushSave();
  if (useApp.getState().saveStatus !== 'error') toast('截圖已加入白板；可自行輸入或貼上文字');
}
export async function addPaper(paper: Paper, blob: Blob) {
  const projectId = requireProjectId(); const context = captureContext();
  await db.transaction('rw', db.documents, db.sync, async () => {
    if ((await db.sync.get(projectId))?.state !== 'active') throw new ProjectMissingError();
    await db.documents.put({ projectId, id: paper.id, blob });
  });
  if (!isCurrentContext(context)) throw new Error('專案已變更，未加入文獻。');
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
export function deletePdfHighlight(id: string) {
  useApp.getState().edit(w => erasePdfHighlight(w, id));
  toast('已刪除螢光標註，便條與連線仍保留。可使用復原恢復。');
}
export function deletePdfTranslation(paragraphId: string) {
  const pausesJob = useApp.getState().workspace.pdfTranslationJobs.some(j => j.status === 'running' && j.targets.some(t => t.paragraphId === paragraphId));
  useApp.getState().edit(w => erasePdfTranslation(w, paragraphId));
  toast(pausesJob ? '已刪除翻譯備註並暫停相關任務，可手動接續其餘段落。' : '已刪除翻譯備註，可使用復原恢復。');
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushSave(); });
window.addEventListener('pagehide', event => { void flushSave(); if (event.persisted) useApp.setState({ history: [], future: [] }); });
window.addEventListener('beforeunload', e => { if (!getProjectId() && !useApp.getState().deletedDraft) return; if (pending.length || pendingDrafts.length || useApp.getState().saveStatus !== 'saved') { void flushSave(); e.preventDefault(); } });
