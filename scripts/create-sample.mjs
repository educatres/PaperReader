import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
const doc = await PDFDocument.create();
const serif = await doc.embedFont(StandardFonts.TimesRoman);
const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
const sans = await doc.embedFont(StandardFonts.Helvetica);
const green = rgb(.20, .35, .27), ink = rgb(.22, .25, .20), muted = rgb(.49, .53, .44);
const sections = [
  {
    heading: 'Reading as a Research Practice', subtitle: 'From isolated highlights to connected understanding',
    left: [
      ['Abstract', 'Reading a paper is more than collecting sentences. Understanding emerges when readers connect claims, examine evidence, and revisit the source. This demonstration paper introduces a small, deliberate workflow: read, mark, reflect, and connect. It is an original tutorial document, not a peer-reviewed study.'],
      ['1. Read with a question', 'Before opening a new paper, write down one question that matters to your current research. A question provides a useful lens, but it should not prevent you from noticing unexpected findings. Keep the distinction between what a paper reports and what you infer from it.'],
      ['2. Make a selective mark', 'A useful highlight captures one complete idea. Select enough context to preserve the original meaning, especially when a statement depends on an assumption or a limitation. Marking every sentence makes the important parts harder to find.'],
    ],
    right: [
      ['3. Keep the source close', 'Every research note should retain a path back to the passage that inspired it. Source links make verification easier and help readers reconsider an interpretation later. A page reference is a starting point for checking a claim, not proof that the claim is correct.'],
      ['4. Add your own thinking', 'After selecting a passage, explain why it matters in your own words. A short question, a possible connection, or a disagreement can make a note more useful than a copied paragraph alone. Preserve the original text separately from your interpretation.'],
      ['Try it in PaperReader', 'Use the highlighter tool and select two or three lines on this page. One selection creates one note on the canvas. Click the arrow on the note to return to this source. Click a highlighted passage to find its note again.'],
    ],
  },
  {
    heading: 'Build a map of ideas', subtitle: 'A research canvas is a place to think, not a verdict',
    left: [
      ['5. Connect with care', 'Two notes can be related without one causing the other. Label a connection according to what you actually know: related, supports, contrasts, extends, or needs verification. The relationship is an interpretation made by the reader.'],
      ['6. Compare across papers', 'Bring several papers into the same workspace. Arrange notes by research question, method, dataset, or limitation. When findings appear to disagree, check whether the authors studied different settings or used different measurements.'],
      ['7. Leave room for uncertainty', 'A useful literature map includes unresolved questions. Mark uncertain relationships explicitly. Do not turn a visual arrow into a stronger conclusion than the available evidence supports.'],
    ],
    right: [
      ['8. Invite AI deliberately', 'Translation can help readers approach unfamiliar terminology. A concise summary can suggest an initial structure for a complex passage. Both are aids to reading. Model output should be checked against the original wording and the wider paper.'],
      ['9. Understand the boundary', 'In this application, PDF files and notes stay in your browser. An AI action sends selected text directly to the provider you choose. Your own API key is used only in the current tab and is cleared when the page reloads. Provider billing and data policies still apply.'],
      ['Try connecting two notes', 'Create a second highlight or add a manual note. Drag a connection point from one card to another. Choose a relationship and add a brief explanation. Move a card and watch the connection follow it.'],
    ],
  },
  {
    heading: 'Return, revise, and preserve', subtitle: 'Knowledge develops through repeated encounters',
    left: [
      ['10. Revisit the argument', 'A first reading reveals the outline of a paper. Later readings can reveal missing assumptions, alternative explanations, and connections to other work. Keep the original source available so that notes remain open to revision.'],
      ['11. Read summaries as guides', 'A document summary is an entry point into a paper. It may omit figures, equations, or details that were not captured in the text layer. Page ranges indicate where the input came from; they are not independently verified citations.'],
      ['12. Separate evidence and ideas', 'Distinguish quotations, translations, generated summaries, and personal notes. This separation makes it easier to see what came from the source and what still requires investigation.'],
    ],
    right: [
      ['13. Keep a portable backup', 'Browser storage is useful, but it is not a permanent archive. Clearing site data removes local research material. Export a research pack regularly to preserve PDF files, annotations, notes, and connections together.'],
      ['A small practice to repeat', 'Read with a question. Mark one complete idea. Write a sentence of your own. Connect it to another note. Return to the original. The aim is not to produce the largest collection, but a collection that helps you think more clearly.'],
      ['About this example', 'This tutorial was created for PaperReader. It contains no experimental results or external citations. Try zooming, searching, creating cross-line highlights, and exporting your workspace.'],
    ],
  },
];
function wrap(text, font, size, width) {
  const words = text.split(' '); const lines = []; let line = '';
  for (const word of words) { const next = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line); return lines;
}
for (const [index, section] of sections.entries()) {
  const page = doc.addPage([612, 792]);
  page.drawText('PAPERREADER / A FIELD GUIDE', { x: 48, y: 747, font: sans, size: 8, color: muted });
  page.drawLine({ start: { x: 48, y: 732 }, end: { x: 564, y: 732 }, color: rgb(.79, .83, .75), thickness: .7 });
  page.drawText(section.heading, { x: 48, y: 687, font: bold, size: 26, color: green });
  page.drawText(section.subtitle, { x: 48, y: 665, font: serif, size: 12, color: muted });
  for (const [col, paragraphs] of [section.left, section.right].entries()) {
    const x = 48 + col * 270; let y = 618;
    for (const [heading, text] of paragraphs) {
      page.drawText(heading, { x, y, font: bold, size: 12, color: green }); y -= 22;
      for (const line of wrap(text, serif, 11, 240)) { page.drawText(line, { x, y, font: serif, size: 11, color: ink }); y -= 16; }
      y -= 23;
    }
  }
  page.drawLine({ start: { x: 48, y: 48 }, end: { x: 564, y: 48 }, color: rgb(.84, .87, .80), thickness: .5 });
  page.drawText('Original tutorial document - not a scientific publication', { x: 48, y: 31, font: sans, size: 7, color: muted });
  page.drawText(String(index + 1), { x: 558, y: 31, font: sans, size: 8, color: muted });
}
doc.setTitle('Reading as a Research Practice'); doc.setAuthor('PaperReader');
await writeFile(new URL('../public/sample.pdf', import.meta.url), await doc.save());
