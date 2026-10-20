// Capture before awaiting: returning A -> B -> A must invalidate the first A.
let projectId: string | undefined;
let generation = 0;
let busy = 0;
export const getProjectId = () => projectId;
export function requireProjectId() {
  if (!projectId) throw new Error('請先進入專案。');
  return projectId;
}
export const captureContext = () => ({ projectId, generation });
export const isCurrentContext = (context: ReturnType<typeof captureContext>) => context.projectId === projectId && context.generation === generation;
export function changeProjectContext(id?: string) { projectId = id; generation++; }
export const taskKey = (id: string, owner = getProjectId()) => `${owner || 'none'}\0${id}`;
export const projectLock = (name: string, id = requireProjectId()) => `PaperReader.project.${id}.${name}`;
export const projectStorageKey = (name: string, id = projectId) => `PaperReader.project.${id || 'none'}.${name}`;
export function beginBusyOperation() { busy++; return () => { busy = Math.max(0, busy - 1); }; }
export const hasBusyOperation = () => busy > 0;
let stoppingTasks = 0;
export const tasksStopping = () => stoppingTasks > 0;
const tasks = new Set<Promise<unknown>>();
const cancellations = new Set<() => void>();
export function registerCancellation(cancel: () => void) { cancellations.add(cancel); return () => { cancellations.delete(cancel); }; }
export function trackedTask<T>(run: () => Promise<T>): Promise<T> {
  const promise = run(); tasks.add(promise);
  void promise.finally(() => tasks.delete(promise)).catch(() => {});
  return promise;
}
export async function stopOwnedTasks() {
  stoppingTasks++;
  try {
    for (const cancel of cancellations) cancel();
    await Promise.allSettled([...tasks]);
  } finally { stoppingTasks--; }
}
interface Editor { save: () => void | Promise<void>; snapshot: () => unknown }
const editors = new Set<Editor>();
export function registerEditor(save: Editor['save'], snapshot: Editor['snapshot']) {
  const editor = { save, snapshot }; editors.add(editor);
  return () => { editors.delete(editor); };
}
export async function saveOpenEditors() { for (const editor of editors) await editor.save(); }
export function snapshotOpenEditors() { return [...editors].map(editor => editor.snapshot()); }
