import type { Fit } from "./types";

export function ago(iso?: string, now = Date.now()): string {
  if (!iso) return "";
  const d = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (d <= 0) return "dziś";
  if (d === 1) return "wczoraj";
  return `${d} d temu`;
}

export function agoTime(iso?: string, now = Date.now()): string {
  if (!iso) return "";
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (min < 1) return "przed chwilą";
  if (min < 60) return `${min} min temu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h temu`;
  return ago(iso, now);
}

export const fitClass = (fit?: Fit) => fit?.verdict ?? "stack";

/** "java, kotlin , spring" → ["java", "kotlin", "spring"] */
export const splitList = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
