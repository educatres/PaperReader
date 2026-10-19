import type { Note, Viewport } from '../types';

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
export const readerWindow = params.get('view') === 'reader';
export const boardWindow = params.get('view') === 'board';
export const requestedDocument = params.get('document') || undefined;
const viewportValues = ['x', 'y', 'zoom'].map(key => params.has(key) ? Number(params.get(key)) : NaN);
export const requestedViewport: Viewport | undefined = boardWindow && viewportValues.every(Number.isFinite) && viewportValues[2] >= .2 && viewportValues[2] <= 1.8 ? { x: viewportValues[0], y: viewportValues[1], zoom: viewportValues[2] } : undefined;
export const windowId = params.get('instance') || crypto.randomUUID();
export interface Peer { id: string; reader: boolean; board: boolean; documentId?: string; focusedAt: number; seen: number }
type Message = { type: 'changed' | 'files' | 'hello' | 'closed'; from: string } | { type: 'presence'; from: string; peer: Peer } | { type: 'source'; from: string; to: string; request: string; note: Pick<Note, 'id' | 'documentId'> } | { type: 'ack'; from: string; to: string; request: string } | { type: 'note'; from: string; to: string; noteId: string };
const channel = typeof location !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('PaperReader.windows.v1') : undefined;
const listeners = new Set<(message: Message) => void>(); const peers = new Map<string, Peer>();
const opened = new Map<string, Window>(); const acknowledgements = new Map<string, () => void>();
let currentDocument: string | undefined; let boardVisible = false; let focusedAt = Date.now(); let started = false;
function post(data: Message) { try { if (channel) channel.postMessage(data); else localStorage.setItem('PaperReader.windowMessage', JSON.stringify({ ...data, nonce: crypto.randomUUID() })); } catch { /* Focus refresh still recovers committed data if notifications are unavailable. */ } }
export function send(message: Omit<Message, 'from'>) { post({ ...message, from: windowId } as Message); }
function presence() { const peer: Peer = { id: windowId, reader: readerWindow, board: boardVisible, documentId: currentDocument, focusedAt, seen: Date.now() }; post({ type: 'presence', from: windowId, peer }); }
function receive(message: Message) {
  if (!message || message.from === windowId) return;
  if (message.type === 'hello') presence();
  if (message.type === 'presence') peers.set(message.from, { ...message.peer, seen: Date.now() });
  if (message.type === 'closed') peers.delete(message.from);
  if (message.type === 'ack' && message.to === windowId) acknowledgements.get(message.request)?.();
  for (const listener of listeners) listener(message);
}
if (channel) channel.onmessage = event => receive(event.data);
else window.addEventListener('storage', event => { if (event.key === 'PaperReader.windowMessage' && event.newValue) { try { receive(JSON.parse(event.newValue)); } catch { /* Ignore unrelated storage data. */ } } });
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
  url.searchParams.set('view', 'reader'); url.searchParams.set('document', documentId); url.searchParams.set('instance', instance);
  return url.href;
}
export function openReader(documentId: string) {
  const instance = crypto.randomUUID(); const url = readerURL(documentId, instance);
  return openWindow(url, instance);
}
export function boardURL(viewport: Viewport, instance = crypto.randomUUID()) {
  const url = new URL(location.href); url.search = ''; url.hash = '';
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
  const peer = [...peers.values()].filter(p => p.reader && p.documentId === note.documentId && Date.now() - p.seen < 120000).sort((a, b) => b.focusedAt - a.focusedAt)[0];
  if (!peer) return false;
  opened.get(peer.id)?.focus(); const request = crypto.randomUUID();
  return new Promise(resolve => {
    const timer = setTimeout(() => { acknowledgements.delete(request); resolve(false); }, 700);
    acknowledgements.set(request, () => { clearTimeout(timer); acknowledgements.delete(request); resolve(true); });
    post({ type: 'source', from: windowId, to: peer.id, request, note: source });
  });
}
export function acknowledge(to: string, request: string) { post({ type: 'ack', from: windowId, to, request }); }
export function focusSharedNote(noteId: string) {
  const peer = [...peers.values()].filter(p => p.board && Date.now() - p.seen < 120000).sort((a, b) => b.focusedAt - a.focusedAt)[0];
  if (!peer) return;
  opened.get(peer.id)?.focus(); post({ type: 'note', from: windowId, to: peer.id, noteId });
}
