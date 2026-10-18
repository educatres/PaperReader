import type { Note } from '../types';

// Only allowlisted text crosses the AI boundary. Never serialize a complete Note
// or resolve an image asset here, even for providers that support vision inputs.
export function noteTextFields(note: Note) {
  return { originalText: note.originalText, existingAITranslation: note.translation?.text || '', existingAISummary: note.summary?.text || '', userNotes: note.userNotes };
}
export function hasNoteText(note: Note) {
  return Object.values(noteTextFields(note)).some(text => text.trim());
}
export function singleNoteText(note: Note) {
  if (note.type === 'screenshot-note') return [note.originalText, note.userNotes].filter(text => text.trim()).join('\n\n');
  return note.originalText.trim() ? note.originalText : note.userNotes;
}
