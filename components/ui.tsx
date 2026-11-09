"use client";

import { useState } from "react";
import type { Fit } from "@/lib/types";

/** Claude's score as a ring; before rating, a dashed ring with the share of the stack found in the CV. */
export function ScoreRing({ fit, stack, size = 40 }: { fit?: Fit; stack?: number; size?: number }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const value = fit ? fit.score : stack;
  const cls = fit ? `ring ${fit.verdict}` : "ring stack";
  const title = fit ? `Ocena Claude: ${fit.score}/100` : stack != null ? `Bez oceny · ${stack}% technologii z CV` : "Bez oceny";
  return (
    <span className={cls} style={{ width: size, height: size }} title={title}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="track" />
        {value != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            className="bar"
            strokeDasharray={fit ? `${(c * value) / 100} ${c}` : "3 3"}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <b style={{ fontSize: size * (fit ? 0.34 : 0.27) }}>{value == null ? "–" : fit ? value : `${value}%`}</b>
    </span>
  );
}

const PALETTE = ["#6366f1", "#0891b2", "#059669", "#d97706", "#db2777", "#7c3aed", "#2563eb", "#dc2626"];

function initials(name: string) {
  const words = name
    .replace(/\b(sp\.?|z o\.?o\.?|s\.?a\.?|ltd|gmbh|inc|llc|poland|polska)\b/gi, "")
    .split(/[\s\-.&]+/)
    .filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

/** The portal's company logo, or coloured initials when there is none (or it fails to load). */
export function Logo({ src, name, size = 36 }: { src?: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <span className="logo-img" style={{ width: size, height: size }}>
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </span>
    );
  }
  const color = PALETTE[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
  return (
    <span className="logo-img initials" style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd>{children}</kbd>;
}

const ICONS = {
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  sparkle: <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />,
  building: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  columns: <><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="11" rx="1.5" /><rect x="17" y="4" width="4" height="7" rx="1.5" /></>,
} as const;

export type IconName = keyof typeof ICONS;

/** Stroke icons (24×24), coloured by the text colour. */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}
