import { now, type Workspace } from '../types';

export const collections = ['documents', 'notes', 'highlights', 'edges', 'jobs', 'pdfLayouts', 'pdfParagraphs', 'pdfTranslations', 'pdfTranslationJobs'] as const;
type Collection = typeof collections[number];
export interface Patch { collection: Collection | 'workspace'; id?: string; field?: string; before?: unknown; after?: unknown }
export interface Change { id: string; projectId: string; epoch: string; patches: Patch[] }
export interface ConflictDraft extends Change { createdAt: string; reason: string }
export interface SyncVersion { id: string; epoch: string; revision: number; recent?: string[]; state?: 'active' | 'deleted' }
type RecordValue = Record<string, unknown>;
export const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const comparable = (value: unknown) => value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'updatedAt')) : value;

export function changesBetween(before: Workspace, after: Workspace): Patch[] {
  const patches: Patch[] = [];
  if (before.title !== after.title) patches.push({ collection: 'workspace', field: 'title', before: before.title, after: after.title });
  for (const collection of collections) {
    const old = new Map(before[collection].map(value => [value.id, value]));
    const next = new Map(after[collection].map(value => [value.id, value]));
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      const a = old.get(id); const b = next.get(id);
      if (!a || !b) { patches.push({ collection, id, before: a, after: b }); continue; }
      const left = a as unknown as RecordValue; const right = b as unknown as RecordValue;
      for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (field !== 'updatedAt' && !equal(left[field], right[field])) patches.push({ collection, id, field, before: left[field], after: right[field] });
      }
    }
  }
  return structuredClone(patches);
}
export const invertPatches = (patches: Patch[]): Patch[] => patches.map(p => ({ ...p, before: p.after, after: p.before }));
export function patchValue(workspace: Workspace, patch: Patch): unknown {
  if (patch.collection === 'workspace') return workspace.title;
  const item = workspace[patch.collection].find(item => item.id === patch.id);
  return patch.field ? (item as unknown as RecordValue | undefined)?.[patch.field] : item;
}
export function applyPatches(workspace: Workspace, patches: Patch[], check = true): Workspace | undefined {
  const next = structuredClone(workspace);
  for (const patch of patches) {
    const current = patchValue(next, patch);
    if (check && !equal(comparable(current), comparable(patch.before)) && !equal(comparable(current), comparable(patch.after))) return;
    if (patch.collection === 'workspace') { next.title = String(patch.after); continue; }
    const items = next[patch.collection] as unknown as RecordValue[];
    const index = items.findIndex(item => item.id === patch.id);
    if (patch.field) {
      if (index < 0) return;
      if (patch.after === undefined) delete items[index][patch.field]; else items[index][patch.field] = structuredClone(patch.after);
      if ('updatedAt' in items[index]) items[index].updatedAt = now();
    } else if (patch.after === undefined) { if (index >= 0) items.splice(index, 1); }
    else if (index < 0) items.push(structuredClone(patch.after) as RecordValue);
    else items[index] = structuredClone(patch.after) as RecordValue;
  }
  const docs = new Set(next.documents.map(d => d.id)); const notes = new Set(next.notes.map(n => n.id)); const highlights = new Set(next.highlights.map(h => h.id));
  if (next.highlights.some(h => !docs.has(h.documentId) || !notes.has(h.noteId)) || next.notes.some(n => n.documentId && !docs.has(n.documentId) || n.highlightId && !highlights.has(n.highlightId)) || next.edges.some(e => !notes.has(e.source) || !notes.has(e.target)) || next.jobs.some(j => !docs.has(j.documentId))) return;
  const layouts = new Map(next.pdfLayouts.map(l => [l.id, l]));
  const paragraphs = new Map(next.pdfParagraphs.map(p => [p.id, p]));
  const papers = new Map(next.documents.map(d => [d.id, d]));
  if (next.pdfLayouts.some(l => papers.get(l.documentId)?.sha256 !== l.documentHash)
    || next.pdfParagraphs.some(p => layouts.get(p.layoutId)?.documentId !== p.documentId || layouts.get(p.layoutId)?.pageIndex !== p.pageIndex || layouts.get(p.layoutId)?.layoutVersion !== p.layoutVersion || !docs.has(p.documentId))
    || next.pdfTranslations.some(t => paragraphs.get(t.paragraphId)?.sourceHash !== t.sourceHash || paragraphs.get(t.paragraphId)?.documentId !== t.documentId || paragraphs.get(t.paragraphId)?.layoutVersion !== t.layoutVersion)
    || next.pdfTranslationJobs.some(j => papers.get(j.documentId)?.sha256 !== j.documentHash || j.targets.some(t => paragraphs.get(t.paragraphId)?.documentId !== j.documentId || paragraphs.get(t.paragraphId)?.sourceHash !== t.sourceHash || paragraphs.get(t.paragraphId)?.layoutVersion !== j.layoutVersion))) return;
  next.updatedAt = now();
  return next;
}
export function rebasePatches(workspace: Workspace, patches: Patch[]): Patch[] | undefined {
  // An explicit conflict choice may replace a field, but cannot recreate a deleted entity.
  if (patches.some(p => p.field && p.collection !== 'workspace' && !workspace[p.collection].some(item => item.id === p.id))) return;
  return patches.map(p => ({ ...p, before: structuredClone(patchValue(workspace, p)) }));
}
