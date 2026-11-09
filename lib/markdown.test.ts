import { describe, expect, it } from "vitest";
import { markdownToText, parseInline, parseMarkdown } from "./markdown";

describe("markdown", () => {
  it("parses the CV subset", () => {
    const md = "# Jan Kowalski\njan@example.com · [GitHub](https://github.com/jan)\n\n## Doświadczenie\n### Allegro – Senior Developer\n- **Kotlin**, Spring\n- Migracja\n  na Kafkę\n\n---\nKoniec";
    expect(parseMarkdown(md)).toEqual([
      { type: "heading", level: 1, content: [{ text: "Jan Kowalski" }] },
      { type: "paragraph", content: [{ text: "jan@example.com · " }, { text: "GitHub", href: "https://github.com/jan" }] },
      { type: "heading", level: 2, content: [{ text: "Doświadczenie" }] },
      { type: "heading", level: 3, content: [{ text: "Allegro – Senior Developer" }] },
      { type: "list", items: [[{ text: "Kotlin", bold: true }, { text: ", Spring" }], [{ text: "Migracja na Kafkę" }]] },
      { type: "rule" },
      { type: "paragraph", content: [{ text: "Koniec" }] },
    ]);
  });

  it("handles italics and plain text export", () => {
    expect(parseInline("a *b* _c_ d")).toEqual([{ text: "a " }, { text: "b", italic: true }, { text: " " }, { text: "c", italic: true }, { text: " d" }]);
    expect(markdownToText("## Umiejętności\n- Java\n- [Blog](https://x.dev)")).toBe("UMIEJĘTNOŚCI\n\n• Java\n• Blog (https://x.dev)");
  });
});
