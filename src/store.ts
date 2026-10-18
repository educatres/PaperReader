import { create } from 'zustand';
import { db, loadWorkspace, saveWorkspace } from './lib/db';
import { emptyWorkspace, now, uid, reasoningEfforts, type Workspace, type Preferences, type Note, type Highlight, type Paper, type Point, type Screenshot, type ImageAsset } from './types';

const defaultPreferences: Preferences = { provider: 'openai', models: { openai: 'gpt-6-luna', gemini: '', cgu: 'gpt-6-luna' }, reasoningEffort: 'medium', toolbarCollapsed: false, cguConnection: 'localhost', split: 54, lastPage: {} };
function readPreferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem('PaperReader.preferences') || '{}');
    return { ...defaultPreferences, provider: ['openai', 'gemini', 'cgu'].includes(p.provider) ? p.provider : 'openai',
      models: { openai: typeof p.models?.openai === 'string' ? p.models.openai : defaultPreferences.models.openai, gemini: typeof p.models?.gemini === 'string' ? p.models.gemini : '', cgu: typeof p.models?.cgu === 'string' ? p.models.cgu : defaultPreferences.models.cgu },
      reasoningEffort: reasoningEfforts.includes(p.reasoningEffort) ? p.reasoningEffort : 'medium', toolbarCollapsed: p.toolbarCollapsed === true,
      cguConnection: p.cguConnection === 'direct' ? 'direct' : 'localhost',
      split: typeof p.split === 'number' ? Math.max(30, Math.min(75, p.split)) : 54, lastPage: p.lastPage || {} };
  } catch { return defaultPreferences; }
}
let pending: Workspace | undefined;
let timer: ReturnType<typeof setTimeout>;
let writeQueue: Promise<void> = Promise.resolve();
function scheduleSave(workspace: Workspace) {
  pending = structuredClone(workspace);
  useApp.setState({ saveStatus: 'saving' });
  clearTimeout(timer);
  timer = setTimeout(flushSave, 200);
}
export async function flushSave() {
  clearTimeout(timer);
  const snapshot = pending;
  if (!snapshot) return writeQueue;
  pending = undefined;
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    try {
      await saveWorkspace(snapshot);
      if (!pending) useApp.setState({ saveStatus: 'saved' });
    } catch {
      pending ||= snapshot;
      useApp.setState({ saveStatus: 'error' });
      toast('本機儲存失敗，可能是空間不足。請先匯出研究封裝備份。', 'error');
    }
  });
  return writeQueue;
}
interface AppState {
  workspace: Workspace; preferences: Preferences; ready: boolean;
  saveStatus: 'saved' | 'saving' | 'error'; history: Workspace[]; future: Workspace[];
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
  saveStatus: 'saved', history: [], future: [], sourceFocusSerial: 0, documentEpoch: 0, settingsOpen: false, helpOpen: false, exportOpen: false,
  edit(change, history = true) {
    const old = get().workspace;
    const next = structuredClone(old);
    change(next); next.updatedAt = now();
    set({ workspace: next, ...(history ? { history: [...get().history.slice(-39), old], future: [] } : {}) });
    scheduleSave(next);
  },
  pref(change) {
    const preferences = { ...get().preferences, ...change };
    set({ preferences });
    try { localStorage.setItem('PaperReader.preferences', JSON.stringify(preferences)); } catch { /* memory settings still work */ }
  },
  undo() {
    const { history, workspace, future } = get(); if (!history.length) return;
    const next = history[history.length - 1];
    set({ workspace: next, history: history.slice(0, -1), future: [workspace, ...future] }); scheduleSave(next);
  },
  redo() {
    const { history, workspace, future } = get(); if (!future.length) return;
    const next = future[0];
    set({ workspace: next, history: [...history, workspace], future: future.slice(1) }); scheduleSave(next);
  },
}));
export async function initialize() {
  try { const ws = await loadWorkspace(); if (ws) useApp.setState({ workspace: ws }); }
  catch { toast('無法開啟本機資料庫。請允許網站儲存空間，再重新整理。', 'error'); }
  finally { useApp.setState({ ready: true }); }
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
export function addHighlight(highlight: Highlight) {
  const note: Note = { id: highlight.noteId, documentId: highlight.documentId, highlightId: highlight.id, type: 'highlight-note',
    title: highlight.normalizedText.slice(0, 48), originalText: highlight.rawText || highlight.selectedText, userNotes: '', tags: [],
    position: nextPosition(), width: 320, collapsed: false, hidden: false, color: highlight.color, updatedAt: now() };
  useApp.getState().edit(w => { w.highlights.push(highlight); w.notes.push(note); });
  useApp.setState({ selectedNoteId: note.id, focusNoteId: note.id });
  toast('已新增便條，靈感已留在白板上');
}
export function focusSource(note: Note) {
  if (!note.documentId) return;
  useApp.getState().edit(w => { w.activeDocumentId = note.documentId; }, false);
  useApp.setState(s => ({ focusHighlightId: note.highlightId, focusScreenshotNoteId: note.screenshot ? note.id : undefined, sourceFocusSerial: s.sourceFocusSerial + 1, selectedNoteId: note.id }));
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
window.addEventListener('pagehide', () => { void flushSave(); });
window.addEventListener('beforeunload', e => { if (pending || useApp.getState().saveStatus !== 'saved') { void flushSave(); e.preventDefault(); } });
