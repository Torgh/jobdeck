import { describe, expect, it } from "vitest";
import { markdownToDocx } from "./docx";

describe("markdownToDocx", () => {
  it("produces a Word file (zip) containing the text", async () => {
    const bytes = await markdownToDocx("# Jan Kowalski\n\n## Doświadczenie\n- **Kotlin** w Allegro\n\n[GitHub](https://github.com/jan)", "CV – Acme");
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    const { unzipSync, strFromU8 } = await import("fflate");
    const xml = strFromU8(unzipSync(bytes)["word/document.xml"]);
    expect(xml).toContain("Jan Kowalski");
    expect(xml).toContain("Doświadczenie");
    expect(xml).toContain("Kotlin");
  });
});
