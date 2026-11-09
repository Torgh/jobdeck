const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8", ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} z ${new URL(url).host}`);
  return res.text();
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  return JSON.parse(await fetchText(url, { ...init, headers: { Accept: "application/json", ...init.headers } })) as T;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Readable plain text from HTML: keeps paragraphs and list items, drops scripts and styles. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, "")
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<(br|\/p|\/div|\/h\d|\/li|\/ul|\/ol|\/tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    // List items one per line, without blank lines between them.
    .replace(/\n+(?=• )/g, "\n")
    .trim();
}

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
