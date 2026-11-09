/**
 * The small Markdown subset Claude writes CVs and cover letters in: headings, paragraphs, bullet lists,
 * rules and inline **bold**, *italic* and [links](url). Parsed once, rendered as React (preview, print → PDF)
 * and as DOCX.
 */

export type Inline = { text: string; bold?: boolean; italic?: boolean; href?: string };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; content: Inline[] }
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; items: Inline[][] }
  | { type: "rule" };

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\(([^)\s]+)\))/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[2] ?? m[3]) out.push({ text: (m[2] ?? m[3])!, bold: true });
    else if (m[4] ?? m[5]) out.push({ text: (m[4] ?? m[5])!, italic: true });
    else out.push({ text: m[6], href: m[7] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.filter((i) => i.text);
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] | undefined;
  const flush = () => {
    if (para.length) blocks.push({ type: "paragraph", content: parseInline(para.join(" ")) });
    if (list) blocks.push({ type: "list", items: list.map(parseInline) });
    para = [];
    list = undefined;
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (!line.trim()) {
      flush();
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      blocks.push({ type: "rule" });
    } else if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, content: parseInline(heading[2]) });
    } else if (bullet) {
      if (para.length) {
        const keep = list;
        list = undefined;
        flush();
        list = keep;
      }
      (list ??= []).push(bullet[1]);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // A wrapped bullet continues on an indented line.
      list[list.length - 1] += ` ${line.trim()}`;
    } else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

/** Plain text, e.g. for copying into an application form. */
export function markdownToText(md: string): string {
  return parseMarkdown(md)
    .map((b) => {
      const t = (c: Inline[]) => c.map((i) => (i.href && i.href !== i.text ? `${i.text} (${i.href})` : i.text)).join("");
      if (b.type === "heading") return t(b.content).toUpperCase();
      if (b.type === "paragraph") return t(b.content);
      if (b.type === "list") return b.items.map((i) => `• ${t(i)}`).join("\n");
      return "—";
    })
    .join("\n\n");
}
