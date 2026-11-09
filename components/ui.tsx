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
