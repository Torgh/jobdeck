"use client";

export function PrintBar({ back }: { back: string }) {
  return (
    <div className="print-bar">
      <a className="btn" href={back}>
        ← Wróć
      </a>
      <span className="muted small">W oknie drukowania wybierz „Zapisz jako PDF”.</span>
      <button className="btn primary" onClick={() => window.print()}>
        Drukuj / zapisz PDF
      </button>
    </div>
  );
}
