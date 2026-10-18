import { describe, expect, it } from 'vitest';
import { rotateRegion, selectionRect } from '../src/lib/screenshots';
import { singleNoteText } from '../src/lib/noteText';
import { prepareGroupSummary } from '../src/lib/groupSummary';
import { emptyWorkspace, now, type Note } from '../src/types';

const imageNote = (id: string): Note => ({ id, type: 'screenshot-note', title: 'A figure without a transcription', originalText: '', userNotes: '', tags: [],
  position: { x: 0, y: 0 }, width: 320, collapsed: false, hidden: false, color: 'blue', updatedAt: now(),
  screenshot: { assetId: 'private-image-do-not-send', sha256: 'a'.repeat(64), size: 100, width: 80, height: 50, pageIndex: 1, region: { x: .2, y: .1, width: .4, height: .3 }, rotation: 90 } });

describe('PDF region coordinates and text boundary', () => {
  it('preserves a source region through all view rotations, including reverse drags at page boundaries', () => {
    const source = { x: .15, y: .2, width: .3, height: .5 };
    for (const rotation of [0, 90, 180, 270]) {
      const restored = rotateRegion(rotateRegion(source, rotation), -rotation);
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(restored[key]).toBeCloseTo(source[key], 12);
    }
    const turned = rotateRegion(source, 90); expect(turned.x).toBeCloseTo(.3); expect(turned).toMatchObject({ y: .15, width: .5, height: .3 });
    const clipped = selectionRect({ x: .8, y: .9 }, { x: -.2, y: 2 });
    expect(clipped.x).toBe(0); expect(clipped.y).toBe(.9); expect(clipped.width).toBe(.8); expect(clipped.height).toBeCloseTo(.1);
    expect(rotateRegion({ x: .7, y: .7, width: .3, height: .3 }, 180).x).toBeGreaterThanOrEqual(0);
  });
  it('excludes all attachment data from single and connected summaries, retaining empty-note relations', () => {
    const w = emptyWorkspace(); const a = imageNote('a'); const b = imageNote('b');
    w.notes = [a, b]; w.edges = [{ id: 'ab', source: 'a', target: 'b', relationType: '對比', label: 'Compare the supplied text', directed: true, createdBy: 'user', createdAt: now(), updatedAt: now() }];
    expect(singleNoteText(a)).toBe(''); expect(() => prepareGroupSummary(w, 'a')).toThrow('尚無可摘要');
    a.originalText = 'Manually pasted evidence'; a.userNotes = 'User interpretation';
    expect(singleNoteText(a)).toBe('Manually pasted evidence\n\nUser interpretation');
    const plan = prepareGroupSummary(w, 'a'); const body = JSON.parse(plan.input);
    expect(body.notes[1].contentStatus).toContain('no text'); expect(body.relations[0]).toMatchObject({ relationType: '對比', directed: true });
    expect(plan.input).toContain(a.originalText); expect(plan.input).toContain(a.userNotes);
    for (const value of ['private-image-do-not-send', 'sha256', 'region', 'assetId', 'blob:', 'data:image', 'image_url']) expect(plan.input).not.toContain(value);
    expect(plan.input).not.toContain(a.screenshot!.sha256);
  });
});
