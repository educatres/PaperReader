export type Color = 'yellow' | 'green' | 'pink' | 'blue';
export type Provider = 'openai' | 'gemini';
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
  createdAt: string; updatedAt: string;
}
export interface AIResult {
  text: string; provider: Provider; model: string; createdAt: string; usage?: number;
}
export interface Note {
  id: string; documentId?: string; highlightId?: string;
  type: 'highlight-note' | 'manual-note' | 'document-summary';
  title: string; originalText: string; translation?: AIResult; summary?: AIResult;
  userNotes: string; tags: string[]; position: Point; width: number;
  collapsed: boolean; hidden: boolean; color: Color; updatedAt: string;
}
export const relations = ['相關', '支持', '對比', '延伸', '待驗證'] as const;
export interface Relation {
  id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string;
  relationType: typeof relations[number]; label: string; directed: boolean;
  createdBy: 'user'; createdAt: string; updatedAt: string;
}
export interface Chunk { text: string; startPage: number; endPage: number }
export interface SummaryJob {
  id: string; documentId: string; provider: Provider; model: string;
  chunks: Chunk[]; results: (AIResult | null)[]; status: 'paused' | 'running' | 'failed' | 'complete';
  error?: string; resultNoteId?: string; createdAt: string;
}
export interface Workspace {
  schemaVersion: 1; id: string; title: string; documents: Paper[]; activeDocumentId?: string;
  highlights: Highlight[]; notes: Note[]; edges: Relation[]; jobs: SummaryJob[];
  viewport: Viewport; updatedAt: string;
}
export interface Preferences {
  provider: Provider; models: Record<Provider, string>; split: number; lastPage: Record<string, number>;
}
export const colors: Record<Color, string> = {
  yellow: '#e6c75e', green: '#88bda0', pink: '#dfa2b6', blue: '#9ab9d9',
};
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const emptyWorkspace = (): Workspace => ({
  schemaVersion: 1, id: 'default', title: '我的研究空間', documents: [], highlights: [], notes: [],
  edges: [], jobs: [], viewport: { x: 35, y: 50, zoom: 0.85 }, updatedAt: now(),
});
