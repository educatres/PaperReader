import { describe, expect, it } from 'vitest';
import { emptyWorkspace, now, type Note, type Relation } from '../src/types';
import { connectedGroup, prepareGroupSummary, maxGroupCharacters } from '../src/lib/groupSummary';

const note = (id: string, extra: Partial<Note> = {}): Note => ({ id, type: 'manual-note', title: id, originalText: `Original ${id}`, userNotes: `Notes ${id}`, tags: [], position: { x: 0, y: 0 }, width: 320, hidden: false, collapsed: false, color: 'yellow', updatedAt: now(), ...extra });
const edge = (source: string, target: string, type: Relation['relationType'] = '相關', directed = false): Relation => ({ id: `${source}-${target}`, source, target, relationType: type, label: `Description ${source}-${target}`, directed, createdBy: 'user', createdAt: now(), updatedAt: now() });

describe('connected-note synthesis boundary', () => {
  it('traverses indirect links and cycles in either direction, excluding hidden bridges and unrelated notes', () => {
    const w = emptyWorkspace();
    w.notes = ['a', 'b', 'c', 'outside', 'past-hidden'].map(id => note(id)); w.notes.push(note('hidden', { hidden: true }));
    w.edges = [edge('a', 'b', '支持', true), edge('b', 'c', '對比'), edge('c', 'a', '延伸', true), edge('b', 'hidden'), edge('hidden', 'past-hidden'), edge('a', 'missing')];
    const group = connectedGroup(w, 'b');
    expect(group.notes.map(n => n.id)).toEqual(['b', 'a', 'c']);
    expect(group.edges.map(e => e.id)).toEqual(['a-b', 'b-c', 'c-a']);
    expect(connectedGroup(w, 'hidden')).toEqual({ notes: [], edges: [] });
    expect(connectedGroup(w, 'missing')).toEqual({ notes: [], edges: [] });
  });
  it('keeps relationship types, labels and direction distinct, with stable source references and all note fields', () => {
    const w = emptyWorkspace(); w.notes = [note('a'), note('b', { summary: { text: 'Prior AI summary', provider: 'cgu', model: 'gpt-6-luna', createdAt: now() } })];
    w.edges = [edge('b', 'a', '待驗證', true), { ...edge('a', 'b', '對比'), label: '' }];
    const plan = prepareGroupSummary(w, 'a'); const data = JSON.parse(plan.input);
    expect(data.relations).toEqual([
      { ref: 'R1', source: 'N2', target: 'N1', relationType: '待驗證', label: 'Description b-a', directed: true },
      { ref: 'R2', source: 'N1', target: 'N2', relationType: '對比', label: '', directed: false },
    ]);
    expect(data.notes[1]).toMatchObject({ ref: 'N2', originalText: 'Original b', existingAISummary: 'Prior AI summary', userNotes: 'Notes b' });
    expect(plan.sourceText).toContain('[R1] [N2] → [N1] · 待驗證');
    expect(plan.sourceText).toContain('[R2] [N1] ↔ [N2] · 對比');
    w.notes[0].title = 'Changed later'; w.edges[0].label = 'Changed later';
    expect(plan.provenance.sources[0].title).toBe('a');
    expect(plan.provenance.relations[0].label).toBe('Description b-a');
  });
  it('rejects isolated notes, empty groups and oversized input without silently dropping content', () => {
    const w = emptyWorkspace(); w.notes = [note('a'), note('b')];
    expect(() => prepareGroupSummary(w, 'a')).toThrow('至少需要兩張');
    w.edges = [edge('a', 'b')]; w.notes.forEach(n => { n.originalText = ''; n.userNotes = ''; });
    expect(() => prepareGroupSummary(w, 'a')).toThrow('尚無可摘要');
    w.notes[0].originalText = 'x'.repeat(maxGroupCharacters);
    expect(() => prepareGroupSummary(w, 'a')).toThrow('不會自動截斷');
  });
});
