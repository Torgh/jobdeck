import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { parseMarkdown, type Inline } from "../markdown";

const FONT = "Calibri";

function runs(content: Inline[]) {
  return content.map((i) =>
    i.href
      ? new ExternalHyperlink({ link: i.href, children: [new TextRun({ text: i.text, style: "Hyperlink", font: FONT })] })
      : new TextRun({ text: i.text, bold: i.bold, italics: i.italic, font: FONT }),
  );
}

const HEADING = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;

/** A Word document from the Markdown subset in lib/markdown.ts, laid out like the PDF view. */
export async function markdownToDocx(md: string, title: string): Promise<Uint8Array> {
  const children: Paragraph[] = [];
  for (const b of parseMarkdown(md)) {
    if (b.type === "heading") {
      children.push(
        new Paragraph({
          heading: HEADING[b.level],
          alignment: b.level === 1 ? AlignmentType.LEFT : undefined,
          spacing: { before: b.level === 1 ? 0 : 240, after: 80 },
          border: b.level === 2 ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB", space: 2 } } : undefined,
          children: runs(b.content),
        }),
      );
    } else if (b.type === "paragraph") {
      children.push(new Paragraph({ spacing: { after: 120 }, children: runs(b.content) }));
    } else if (b.type === "list") {
      for (const item of b.items) children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: runs(item) }));
    } else {
      children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB", space: 4 } } }));
    }
  }
  const doc = new Document({
    title,
    creator: "JobDeck",
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
