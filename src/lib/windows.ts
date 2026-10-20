import type { Note, Viewport } from '../types';
import { getProjectId } from './projectContext';

export interface ProjectRoute { projectId?: string; view: 'projects' | 'main' | 'reader' | 'board'; documentId?: string; viewport?: Viewport }
export function parseRoute(search = typeof location === 'undefined' ? '' : location.search): ProjectRoute {
  const params = new URLSearchParams(search); const view = params.get('view');
  const projectId = params.get('project') || (view === 'reader' || view === 'board' ? 'default' : undefined);
  const values = ['x', 'y', 'zoom'].map(key => params.has(key) ? Number(params.get(key)) : NaN);
  return { projectId: view === 'projects' ? undefined : projectId, view: view === 'reader' || view === 'board' ? view : projectId && view !== 'projects' ? 'main' : 'projects',
    documentId: params.get('document') || undefined,
    viewport: values.every(Number.isFinite) && values[2] >= .2 && values[2] <= 1.8 ? { x: values[0], y: values[1], zoom: values[2] } : undefined };
}
export let readerWindow = false;
export let boardWindow = false;
export let requestedDocument: string | undefined;
export let requestedViewport: Viewport | undefined;
export function applyRoute(route: ProjectRoute) {
  readerWindow = route.view === 'reader'; boardWindow = route.view === 'board';
  requestedDocument = route.documentId; requestedViewport = route.viewport;
  currentDocument = undefined; boardVisible = false;
}
export function projectURL(projectId?: string) {
  const url = new URL(location.href); url.search = ''; url.hash = '';
  if (projectId) url.searchParams.set('project', projectId); else url.searchParams.set('view', 'projects');
  return url.href;
}
export const windowId = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('instance') || crypto.randomUUID();
export interface Peer { id: string; projectId?: string; reader: boolean; board: boolean; documentId?: string; focusedAt: number; seen: number }
type Payload = { type: 'changed' | 'files' | 'hello' | 'closed' } | { type: 'presence'; peer: Peer } | { type: 'source'; to: string; request: string; note: Pick<Note, 'id' | 'documentId'> } | { type: 'ack'; to: string; request: string } | { type: 'note'; to: string; noteId: string };
type Message = Payload & { from: string; projectId?: string };
const channel = typeof location !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('PaperReader.windows.v2') : undefined;
const listeners = new Set<(message: Message) => void>(); const peers = new Map<string, Peer>();
const opened = new Map<string, Window>(); const acknowledgements = new Map<string, () => void>();
let currentDocument: string | undefined; let boardVisible = false; let focusedAt = Date.now(); let started = false;
function post(data: Message) { try { if (channel) channel.postMessage(data); else localStorage.setItem('PaperReader.windowMessage.v2', JSON.stringify({ ...data, nonce: crypto.randomUUID() })); } catch { /* Focus refresh still recovers committed data if notifications are unavailable. */ } }
export function send(message: Payload, projectId = getProjectId()) { post({ ...message, from: windowId, projectId }); }
function presence() { const peer: Peer = { id: windowId, projectId: getProjectId(), reader: !!getProjectId() && readerWindow, board: !!getProjectId() && boardVisible, documentId: currentDocument, focusedAt, seen: Date.now() }; send({ type: 'presence', peer }); }
function receive(message: Message) {
  if (!message || message.from === windowId) return;
  if (message.type === 'hello') presence();
  if (message.type === 'presence') peers.set(message.from, { ...message.peer, seen: Date.now() });
  if (message.type === 'closed') peers.delete(message.from);
  if (message.type === 'ack' && message.projectId === getProjectId() && message.to === windowId) acknowledgements.get(message.request)?.();
  for (const listener of listeners) listener(message);
}
if (channel) channel.onmessage = event => receive(event.data);
else window.addEventListener('storage', event => { if (event.key === 'PaperReader.windowMessage.v2' && event.newValue) { try { receive(JSON.parse(event.newValue)); } catch { /* Ignore unrelated storage data. */ } } });
export function listenWindows(listener: (message: Message) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function announceDocument(documentId?: string) { currentDocument = documentId; if (started) presence(); }
export function announceBoard(visible: boolean) { boardVisible = visible; if (started) presence(); }
export function startWindows() {
  if (started) return; started = true; send({ type: 'hello' }); presence();
  setInterval(presence, 10000);
  const used = () => { focusedAt = Date.now(); presence(); };
  window.addEventListener('focus', used);
  window.addEventListener('pointerdown', used, { passive: true });
  window.addEventListener('keydown', used, { passive: true });
  window.addEventListener('pagehide', () => send({ type: 'closed' }));
  window.addEventListener('pageshow', presence);
}
export function readerURL(documentId: string, instance = crypto.randomUUID()) {
  const url = new URL(location.href); url.search = ''; url.hash = '';
  url.searchParams.set('project', getProjectId() || 'default');
  url.searchParams.set('view', 'reader'); url.searchParams.set('document', documentId); url.searchParams.set('instance', instance);
  return url.href;
}
export function openReader(documentId: string) {
  const instance = crypto.randomUUID(); const url = readerURL(documentId, instance);
  return openWindow(url, instance);
}
export function boardURL(viewport: Viewport, instance = crypto.randomUUID()) {
  const url = new URL(location.href); url.search = ''; url.hash = '';
  url.searchParams.set('project', getProjectId() || 'default');
  url.searchParams.set('view', 'board'); url.searchParams.set('instance', instance);
  for (const key of ['x', 'y', 'zoom'] as const) url.searchParams.set(key, String(viewport[key]));
  return url.href;
}
export function openBoard(viewport: Viewport) {
  const instance = crypto.randomUUID(); return openWindow(boardURL(viewport, instance), instance);
}
function openWindow(url: string, instance: string) {
  const child = window.open(url, '_blank', 'popup,width=980,height=900');
  if (!child) return url;
  child.opener = null; opened.set(instance, child); return undefined;
}
export async function routeSource(note: Note): Promise<boolean> {
  const source = { id: note.id, documentId: note.documentId };
  const peer = [...peers.values()].filter(p => p.projectId === getProjectId() && p.reader && p.documentId === note.documentId && Date.now() - p.seen < 120000).sort((a, b) => b.focusedAt - a.focusedAt)[0];
  if (!peer) return false;
  opened.get(peer.id)?.focus(); const request = crypto.randomUUID();
  return new Promise(resolve => {
    const timer = setTimeout(() => { acknowledgements.delete(request); resolve(false); }, 700);
    acknowledgements.set(request, () => { clearTimeout(timer); acknowledgements.delete(request); resolve(true); });
    send({ type: 'source', to: peer.id, request, note: source });
  });
}
export function acknowledge(to: string, request: string) { send({ type: 'ack', to, request }); }
export function focusSharedNote(noteId: string) {
  const peer = [...peers.values()].filter(p => p.projectId === getProjectId() && p.board && Date.now() - p.seen < 120000).sort((a, b) => b.focusedAt - a.focusedAt)[0];
  if (!peer) return;
  opened.get(peer.id)?.focus(); send({ type: 'note', to: peer.id, noteId });
}
