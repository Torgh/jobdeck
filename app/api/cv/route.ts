import { saveCv } from "@/lib/server/cv";
import { handle } from "@/lib/server/route";

export async function POST(req: Request) {
  return handle(async () => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Nie wybrano pliku.");
    const cv = await saveCv(file.name, new Uint8Array(await file.arrayBuffer()));
    return { fileName: cv.fileName, uploadedAt: cv.uploadedAt, chars: cv.text.length };
  });
}
