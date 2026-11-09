import type { Metadata } from "next";
import { Markdown } from "@/components/Markdown";
import { docTitle } from "@/lib/docName";
import { readDb } from "@/lib/server/store";
import { DOC_KINDS, type DocKind } from "@/lib/types";
import { PrintBar } from "./PrintBar";

type Search = Promise<{ id?: string; doc?: string }>;

function load(id?: string, doc?: string) {
  const kind = DOC_KINDS.includes(doc as DocKind) ? (doc as DocKind) : "cv";
  const job = id ? readDb().jobs[id] : undefined;
  return { job, kind, md: job?.documents?.[kind]?.markdown };
}

// The title becomes the PDF's default file name in the print dialog.
export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const { id, doc } = await searchParams;
  const { job, kind } = load(id, doc);
  return { title: job ? docTitle(job, kind) : "Dokument" };
}

/** A4 view of a tailored CV / cover letter: print it or save it as PDF from the browser. */
export default async function PrintPage({ searchParams }: { searchParams: Search }) {
  const { id, doc } = await searchParams;
  const { job, md } = load(id, doc);
  return (
    <div className="print-page">
      <PrintBar back={job ? `/?job=${job.id}` : "/"} />
      {md ? <Markdown source={md} className={`sheet doc-${doc === "letter" ? "letter" : "cv"}`} /> : <p className="sheet">Ta oferta nie ma jeszcze takiego dokumentu.</p>}
    </div>
  );
}
