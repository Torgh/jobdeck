import type { NextRequest } from "next/server";
import { docTitle } from "@/lib/docName";
import { markdownToText } from "@/lib/markdown";
import { markdownToDocx } from "@/lib/server/docx";
import { NotFound, saveDocument } from "@/lib/server/jobOps";
import { handle } from "@/lib/server/route";
import { readDb } from "@/lib/server/store";
import { DOC_KINDS, type DocKind } from "@/lib/types";

function kindOf(v: unknown): DocKind {
  if (!DOC_KINDS.includes(v as DocKind)) throw new SyntaxError("Nieznany dokument.");
  return v as DocKind;
}

/** ?id=&doc=cv|letter&format=docx|txt – the tailored document as a file. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  try {
    const job = readDb().jobs[q.get("id") ?? ""];
    const kind = kindOf(q.get("doc"));
    const doc = job?.documents?.[kind];
    if (!job || !doc) throw new NotFound("Ta oferta nie ma jeszcze takiego dokumentu.");
    const name = docTitle(job, kind);
    const ascii = name
      .replace(/[–—]/g, "-")
      .replace(/ł/g, "l")
      .replace(/Ł/g, "L")
      .normalize("NFD")
      .replace(/[^\x20-\x7e]/g, "");
    const disposition = (ext: string) => `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(name)}.${ext}`;
    if (q.get("format") === "txt") {
      return new Response(markdownToText(doc.markdown), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": disposition("txt") } });
    }
    const body = await markdownToDocx(doc.markdown, name);
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": disposition("docx"),
      },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof NotFound ? 404 : 400 });
  }
}

/** { id, doc, markdown } – saves the user's edits (empty markdown removes the document). */
export async function PUT(req: Request) {
  return handle(async () => {
    const { id, doc, markdown } = (await req.json()) as { id: string; doc: string; markdown: string };
    return { job: await saveDocument(id, kindOf(doc), markdown ?? "") };
  });
}
