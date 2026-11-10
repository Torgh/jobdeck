"use client";

import Link from "next/link";
import { Icon } from "./ui";

export type AppTab = "today" | "inbox" | "pipeline";
type Active = AppTab | "insights" | "calculator" | "settings";

const APP_TABS: { id: AppTab; label: string }[] = [
  { id: "today", label: "Dziś" },
  { id: "inbox", label: "Skrzynka" },
  { id: "pipeline", label: "Pipeline" },
];

/** The same header on every page: the board's views, the market, the calculator, settings. */
export function TopNav({
  active,
  counts,
  onTab,
  right,
}: {
  active: Active;
  counts?: Partial<Record<AppTab, number>>;
  /** On the board the views switch in place; elsewhere they link back to it. */
  onTab?: (t: AppTab) => void;
  right?: React.ReactNode;
}) {
  return (
    <header className="topbar">
      <Link href="/" className="brand" onClick={onTab ? (e) => (e.preventDefault(), onTab("today")) : undefined}>
        <img src="/icon.svg" alt="" width={28} height={28} />
        Tropiciel
      </Link>
      <nav className="nav" aria-label="Główne">
        {APP_TABS.map((t) => {
          const count = counts?.[t.id];
          const body = (
            <>
              {t.label}
              {count ? <span className="badge">{count}</span> : null}
            </>
          );
          const cls = active === t.id ? "active" : "";
          return onTab ? (
            <button key={t.id} className={cls} aria-current={active === t.id ? "page" : undefined} onClick={() => onTab(t.id)}>
              {body}
            </button>
          ) : (
            <Link key={t.id} className={cls} href={`/?tab=${t.id}`}>
              {body}
            </Link>
          );
        })}
        <Link className={active === "insights" ? "active" : ""} aria-current={active === "insights" ? "page" : undefined} href="/insights">
          Rynek
        </Link>
        <Link className={active === "calculator" ? "active" : ""} aria-current={active === "calculator" ? "page" : undefined} href="/calculator">
          Kalkulator
        </Link>
      </nav>
      <span className="spacer" />
      {right}
      <Link className={`btn icon-btn${active === "settings" ? " active" : ""}`} href="/settings" aria-label="Ustawienia" title="Ustawienia">
        <Icon name="settings" />
      </Link>
    </header>
  );
}
