import fs from "node:fs";
import path from "node:path";
import { stackMatch } from "../jobs";
import type { CvInfo } from "../types";
import { cvDir, hashText, updateDb, updateProfile } from "./store";

const MAX_BYTES = 8 * 1024 * 1024;

/** Plain text of a CV file: PDF, DOCX, Markdown or text. */
export async function cvText(fileName: string, data: Uint8Array): Promise<string> {
  const ext = path.extname(fileName).toLowerCase();
  let text: string;
  if (ext === ".pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const res = await extractText(pdf, { mergePages: true });
    text = Array.isArray(res.text) ? res.text.join("\n") : res.text;
  } else if (ext === ".docx") {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: Buffer.from(data) })).value;
  } else if ([".txt", ".md", ".markdown"].includes(ext)) {
    text = new TextDecoder().decode(data);
  } else {
    throw new Error("Obsługiwane formaty CV: PDF, DOCX, TXT, MD.");
  }
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 200) {
    throw new Error("Z pliku udało się odczytać bardzo mało tekstu – czy to nie jest skan? Wgraj PDF z tekstem albo DOCX.");
  }
  return text;
}

/** Stores the CV file and its text in the profile, and refreshes the stack match of every offer. */
export async function saveCv(fileName: string, data: Uint8Array): Promise<CvInfo> {
  if (data.byteLength > MAX_BYTES) throw new Error("Plik CV jest za duży (max 8 MB).");
  const safe = path.basename(fileName).replace(/[^\w.\- ()ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/g, "_");
  const text = await cvText(safe, data);
  for (const old of fs.readdirSync(cvDir())) fs.rmSync(path.join(cvDir(), old), { force: true });
  fs.writeFileSync(path.join(cvDir(), safe), data);
  const cv: CvInfo = { fileName: safe, uploadedAt: new Date().toISOString(), hash: hashText(text), text };
  const profile = await updateProfile((p) => {
    p.cv = cv;
  });
  await updateDb((db) => {
    for (const j of Object.values(db.jobs)) j.stackMatch = stackMatch(j.skills, profile);
  });
  return cv;
}
