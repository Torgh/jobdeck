"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

/** Settings: load the test data to try the board out, and remove it again. */
export function DemoDataPanel() {
  const [count, setCount] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  useEffect(() => {
    api<{ count: number }>("/api/demo")
      .then((r) => setCount(r.count))
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  const run = async (method: "POST" | "DELETE") => {
    setBusy(true);
    setMsg(undefined);
    try {
      const r = await api<{ count: number; removed?: number }>("/api/demo", { method });
      setCount(r.count);
      setMsg({ ok: true, text: method === "POST" ? `Wczytano ${r.count} ofert testowych.` : `Usunięto ${r.removed ?? 0} ofert testowych.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2>Dane testowe</h2>
      <p className="hint">
        Kilka fikcyjnych ofert na każdym etapie (z ocenami, follow-upem, rozmową i planem nauki), żeby zobaczyć, jak działa tablica. Są oznaczone jako testowe i usuwa się je
        jednym kliknięciem – Twoje prawdziwe oferty, profil i CV zostają.
      </p>
      <div className="actions-row">
        <button className="btn" onClick={() => run("POST")} disabled={busy}>
          {count ? "Wczytaj ponownie" : "Wczytaj dane testowe"}
        </button>
        <button className="btn no" onClick={() => run("DELETE")} disabled={busy || !count}>
          Usuń dane testowe
        </button>
        <span className="muted small">{count == null ? "" : count ? `Na tablicy: ${count} ofert testowych.` : "Brak danych testowych na tablicy."}</span>
      </div>
      {msg && <p className={`small ${msg.ok ? "ok" : "error"}`}>{msg.text}</p>}
    </div>
  );
}

/** A reminder on the start screen while the test data is on the board. */
export function DemoBanner({ count, onRemoved }: { count: number; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const remove = async () => {
    setBusy(true);
    try {
      await api("/api/demo", { method: "DELETE" });
      onRemoved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="demo-banner" role="status">
      <span>
        Na tablicy są <b>dane testowe</b> ({count} ofert fikcyjnych firm z dopiskiem „(test)”).
      </span>
      <button className="btn small" onClick={remove} disabled={busy}>
        {busy ? "Usuwam…" : "Usuń dane testowe"}
      </button>
      {error && <span className="error small">{error}</span>}
    </div>
  );
}
