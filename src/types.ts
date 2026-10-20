export type Color = 'yellow' | 'green' | 'pink' | 'blue';
export const providers = ['openai', 'cgu', 'gemini', 'mercuryapi', 'grok'] as const;
export type Provider = typeof providers[number];
export const usesReasoningEffort = (provider: Provider) => provider !== 'gemini' && provider !== 'grok';
export const reasoningEfforts = ['low', 'medium', 'high'] as const;
export type ReasoningEffort = typeof reasoningEfforts[number];
export const reasoningLabels: Record<ReasoningEffort, string> = { low: '低', medium: '中', high: '高' };
export type Point = { x: number; y: number };
export type Quad = Point & { width: number; height: number };
export type Viewport = Point & { zoom: number };
export interface Paper {
  id: string; name: string; sha256: string; size: number; pageCount: number;
  pages: string[]; createdAt: string;
}
export interface Highlight {
  id: string; documentId: string; noteId: string; pageIndex: number; displayPage: number;
  selectedText: string; rawText?: string; normalizedText: string; prefix: string; suffix: string;
  textQuoteHash: string; textRange: { start: number; end: number };
  quads: Quad[]; coordinateSystem: 'normalized'; rotation: number;
  color: Color; status: 'resolved' | 'unresolved'; schemaVersion: 1;
  // Keep the source anchor for the note after erasing its PDF overlay.
  deletedAt?: string;
  createdAt: string; updatedAt: string;
}
export interface AIResult {
  text: string; provider: Provider; model: string; createdAt: string; usage?: number; reasoningEffort?: ReasoningEffort;
}
export interface Screenshot {
  assetId: string; sha256: string; size: number; width: number; height: number;
  pageIndex: number; region: Quad; rotation: number;
}
export interface ImageAsset { id: string; blob: Blob; sha256: string }
export interface Note {
  id: string; documentId?: string; highlightId?: string;
  type: 'highlight-note' | 'manual-note' | 'document-summary' | 'group-summary' | 'screenshot-note';
  title: string; originalText: string; translation?: AIResult; summary?: AIResult;
  userNotes: string; tags: string[]; position: Point; width: number;
  collapsed: boolean; hidden: boolean; color: Color; updatedAt: string;
  groupSummary?: GroupSummaryProvenance;
  screenshot?: Screenshot;
}
export const relations = ['相關', '支持', '對比', '延伸', '待驗證'] as const;
export interface Relation {
  id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string;
  relationType: typeof relations[number]; label: string; directed: boolean;
  createdBy: 'user'; createdAt: string; updatedAt: string;
}
export interface GroupSummaryProvenance {
  capturedAt: string;
  sources: { noteId: string; title: string }[];
  relations: Pick<Relation, 'id' | 'source' | 'target' | 'relationType' | 'label' | 'directed'>[];
}
export interface Chunk { text: string; startPage: number; endPage: number }
export interface SummaryJob {
  id: string; documentId: string; provider: Provider; model: string; reasoningEffort?: ReasoningEffort;
  chunks: Chunk[]; results: (AIResult | null)[]; status: 'paused' | 'running' | 'failed' | 'complete';
  error?: string; resultNoteId?: string; createdAt: string;
}
export interface PdfLayout {
  id: string; documentId: string; documentHash: string; layoutVersion: number;
  pageIndex: number; width: number; height: number; rotation: number; viewBox: number[];
  warnings: string[];
}
export interface PdfParagraph {
  id: string; documentId: string; layoutId: string; layoutVersion: number;
  pageIndex: number; regionId: string; columnId: number; order: number;
  rawText: string; normalizedText: string; sourceHash: string; itemIndices: number[];
  lines: Quad[]; columnBounds: { left: number; right: number };
  role: 'text' | 'heading' | 'caption' | 'excluded' | 'review'; reason?: string;
}
export interface PdfTranslation extends AIResult {
  id: string; documentId: string; paragraphId: string; sourceHash: string; layoutVersion: number;
}
export interface PdfTranslationPart {
  start: number; end: number; result?: AIResult;
}
export interface PdfTranslationTarget {
  paragraphId: string; sourceHash: string; parts: PdfTranslationPart[];
  status: 'pending' | 'running' | 'translated' | 'failed'; error?: string;
}
export interface PdfTranslationJob {
  id: string; documentId: string; documentHash: string; layoutVersion: number;
  provider: Provider; model: string; reasoningEffort?: ReasoningEffort;
  targets: PdfTranslationTarget[];
  status: 'pending' | 'running' | 'paused' | 'partial' | 'failed' | 'complete';
  error?: string; createdAt: string; updatedAt: string;
}
export interface Workspace {
  schemaVersion: 2; id: string; title: string; documents: Paper[]; activeDocumentId?: string;
  highlights: Highlight[]; notes: Note[]; edges: Relation[]; jobs: SummaryJob[];
  pdfLayouts: PdfLayout[]; pdfParagraphs: PdfParagraph[]; pdfTranslations: PdfTranslation[]; pdfTranslationJobs: PdfTranslationJob[];
  viewport: Viewport; updatedAt: string;
}
export interface Preferences {
  provider: Provider; models: Record<Provider, string>; reasoningEffort: ReasoningEffort; toolbarCollapsed: boolean; pdfCollapsed: boolean; boardCollapsed: boolean;
  split: number; lastPage: Record<string, number>;
}
export interface ProjectMeta {
  id: string; title: string; createdAt: string; updatedAt: string;
  documentCount: number; noteCount: number; lastOpenedAt?: string;
}
export interface ProjectView {
  projectId: string; kind: string; activeDocumentId?: string; viewport?: Viewport;
  preferences?: Partial<Preferences>; pdf?: Record<string, unknown>;
}
export const colors: Record<Color, string> = {
  yellow: '#e6c75e', green: '#88bda0', pink: '#dfa2b6', blue: '#9ab9d9',
};
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const emptyWorkspace = (id = 'default', title = '我的研究空間'): Workspace => ({
  schemaVersion: 2, id, title, documents: [], highlights: [], notes: [],
  pdfLayouts: [], pdfParagraphs: [], pdfTranslations: [], pdfTranslationJobs: [],
  edges: [], jobs: [], viewport: { x: 35, y: 50, zoom: 0.85 }, updatedAt: now(),
});
