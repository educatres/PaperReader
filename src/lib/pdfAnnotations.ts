import { now, type Workspace } from '../types';

export function erasePdfHighlight(workspace: Workspace, id: string) {
  const highlight = workspace.highlights.find(h => h.id === id);
  if (highlight && !highlight.deletedAt) {
    highlight.deletedAt = now(); highlight.updatedAt = highlight.deletedAt;
  }
}

export function erasePdfTranslation(workspace: Workspace, paragraphId: string) {
  workspace.pdfTranslations = workspace.pdfTranslations.filter(t => t.paragraphId !== paragraphId);
  // Remove saved parts too: a resumed or currently running job must not put the
  // erased annotation back. Unaffected targets can still be resumed manually.
  workspace.pdfTranslationJobs = workspace.pdfTranslationJobs.flatMap(job => {
    if (!job.targets.some(t => t.paragraphId === paragraphId)) return [job];
    job.targets = job.targets.filter(t => t.paragraphId !== paragraphId);
    if (!job.targets.length) return [];
    if (job.status === 'running') {
      job.status = 'paused';
      job.targets.forEach(t => { if (t.status === 'running') t.status = 'pending'; });
      job.error = '已刪除翻譯備註，任務已暫停；可手動接續其餘段落。';
    }
    job.updatedAt = now();
    return [job];
  });
}
