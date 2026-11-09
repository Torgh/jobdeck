"use client";

import { useEffect, useRef, useState } from "react";
import { agoTime, splitList } from "@/lib/format";
import { citiesFor } from "@/lib/jobs";
import {
  CONTRACT_LABEL,
  SENIORITIES,
  SENIORITY_LABEL,
  WORK_MODE_LABEL,
  type Contract,
  type Profile,
  type Seniority,
  type WorkMode,
} from "@/lib/types";
import type { ProfileView } from "@/lib/view";
import { api } from "./api";
import { TopNav } from "./Nav";

/** Text fields hold the comma-separated lists while the user types. */
interface Form {
  keywords: string;
  hybridCities: string;
  officeCities: string;
  excludeKeywords: string;
  excludeCompanies: string;
  skills: string;
  minMonthlyPln: string;
  about: string;
  workModes: WorkMode[];
  seniority: Seniority[];
  contracts: Contract[];
  sources: Profile["sources"];
}

const toForm = (p: ProfileView): Form => ({
  keywords: p.keywords.join(", "),
  hybridCities: citiesFor(p, "hybrid").join(", "),
  officeCities: citiesFor(p, "office").join(", "),
  excludeKeywords: p.excludeKeywords.join(", "),
  excludeCompanies: p.excludeCompanies.join(", "),
  skills: p.skills.join(", "),
  minMonthlyPln: p.minMonthlyPln ? String(p.minMonthlyPln) : "",
  about: p.about ?? "",
  workModes: p.workModes,
  seniority: p.seniority,
  contracts: p.contracts,
  sources: p.sources,
});

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function Settings() {
  const [profile, setProfile] = useState<ProfileView>();
  const [form, setForm] = useState<Form>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const [showCv, setShowCv] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<ProfileView>("/api/profile")
      .then((p) => {
        setProfile(p);
        setForm(toForm(p));
      })
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => f && { ...f, [k]: v });

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const p = await api<ProfileView>("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: splitList(form.keywords),
          modeLocations: { hybrid: splitList(form.hybridCities), office: splitList(form.officeCities) },
          locations: [...new Set([...splitList(form.hybridCities), ...splitList(form.officeCities)])],
          excludeKeywords: splitList(form.excludeKeywords),
          excludeCompanies: splitList(form.excludeCompanies),
          skills: splitList(form.skills),
          minMonthlyPln: form.minMonthlyPln ? Number(form.minMonthlyPln.replace(/\s/g, "")) : null,
          about: form.about,
          workModes: form.workModes,
          seniority: form.seniority,
          contracts: form.contracts,
          sources: form.sources,
        }),
      });
      setProfile(p);
      setForm(toForm(p));
      setMsg({ ok: true, text: "Zapisano." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setMsg(undefined);
    try {
      const body = new FormData();
      body.append("file", file);
      await api("/api/cv", { method: "POST", body });
      const p = await api<ProfileView>("/api/profile");
      setProfile(p);
      setMsg({ ok: true, text: `CV wgrane (${p.cv?.chars} znaków). Poproś Claude, żeby wyciągnął z niego umiejętności i ocenił oferty.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setUploading(false);
    }
  };

  if (!form || !profile) {
    return <div className="page">{msg ? <p className="error">{msg.text}</p> : <p className="muted">Wczytuję…</p>}</div>;
  }

  return (
    <>
      <TopNav active="settings" />
      <div className="page">
        <div className="panel">
          <h2>Twoje CV</h2>
          <p className="hint">Claude porównuje każdą ofertę z treścią CV. Najlepiej PDF z tekstem (nie skan) albo DOCX. Plik zostaje lokalnie na Twoim komputerze.</p>
          <div
            className={`dropzone${over ? " over" : ""}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files[0];
              if (f) upload(f);
            }}
          >
            {uploading
              ? "Wczytuję CV…"
              : profile.cv
                ? `📄 ${profile.cv.fileName} · ${profile.cv.chars} znaków · wgrane ${agoTime(profile.cv.uploadedAt)}. Upuść nowy plik, żeby podmienić.`
                : "Upuść tu CV (PDF, DOCX, TXT, MD) albo kliknij, żeby wybrać plik"}
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
          </div>
          {profile.cv && (
            <>
              <button className="btn" style={{ marginTop: 8 }} onClick={() => setShowCv((v) => !v)}>
                {showCv ? "Ukryj odczytany tekst" : "Pokaż odczytany tekst"}
              </button>
              {showCv && <div className="preview">{profile.cv.preview}</div>}
            </>
          )}
          <label className="field" style={{ marginTop: 14 }}>
            <span>Umiejętności</span>
            <input type="text" value={form.skills} onChange={(e) => set("skills", e.target.value)} placeholder="Java, Spring Boot, Kafka, PostgreSQL, AWS…" />
            <small className="muted">Po przecinku. Claude może je wyciągnąć z CV. Służą do szybkiego „% technologii” na kartach.</small>
          </label>
          <label className="field">
            <span>Czego szukam / czego nie chcę</span>
            <textarea rows={4} value={form.about} onChange={(e) => set("about", e.target.value)} placeholder="np. Backend w produkcie (nie body leasing), fintech lub e-commerce, bez dyżurów nocnych, chcę rozwijać się w kierunku architektury…" />
          </label>
        </div>

        <div className="panel">
          <h2>Wyszukiwanie</h2>
          <p className="hint">Krótkie frazy działają najlepiej – każda jest wyszukiwana osobno na każdym portalu.</p>
          <label className="field">
            <span>Frazy</span>
            <input type="text" value={form.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="java, kotlin, backend" />
          </label>
          <div className="field">
            <span>Tryb pracy i miasta</span>
            <div className="modes">
              {(Object.keys(WORK_MODE_LABEL) as WorkMode[]).map((m) => {
                const on = form.workModes.includes(m);
                const key = m === "hybrid" ? "hybridCities" : "officeCities";
                return (
                  <div key={m} className="mode-row">
                    <label>
                      <input type="checkbox" checked={on} onChange={() => set("workModes", toggle(form.workModes, m))} />
                      {WORK_MODE_LABEL[m]}
                    </label>
                    {m === "remote" ? (
                      <span className="muted small">z całej Polski</span>
                    ) : (
                      <input
                        type="text"
                        value={form[key]}
                        disabled={!on}
                        onChange={(e) => set(key, e.target.value)}
                        placeholder="np. Wrocław (puste = cała Polska)"
                        aria-label={`Miasta – ${WORK_MODE_LABEL[m]}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="field">
            <span>Poziom</span>
            <div className="checks">
              {SENIORITIES.map((s) => (
                <label key={s}>
                  <input type="checkbox" checked={form.seniority.includes(s)} onChange={() => set("seniority", toggle(form.seniority, s))} />
                  {SENIORITY_LABEL[s]}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Umowa</span>
            <div className="checks">
              {(["b2b", "uop", "uz"] as Contract[]).map((c) => (
                <label key={c}>
                  <input type="checkbox" checked={form.contracts.includes(c)} onChange={() => set("contracts", toggle(form.contracts, c))} />
                  {CONTRACT_LABEL[c]}
                </label>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Minimum miesięcznie (PLN)</span>
            <input type="number" min={0} step={500} value={form.minMonthlyPln} onChange={(e) => set("minMonthlyPln", e.target.value)} placeholder="np. 18000" />
            <small className="muted">B2B netto lub UoP brutto. Oferty wyraźnie poniżej są pomijane przy skanie; bez widełek – zostają.</small>
          </label>
        </div>

        <div className="panel">
          <h2>Wykluczenia</h2>
          <label className="field">
            <span>Słowa w tytule</span>
            <input type="text" value={form.excludeKeywords} onChange={(e) => set("excludeKeywords", e.target.value)} placeholder="php, sap, tester manualny" />
          </label>
          <label className="field">
            <span>Firmy</span>
            <input type="text" value={form.excludeCompanies} onChange={(e) => set("excludeCompanies", e.target.value)} placeholder="Firma X, Firma Y" />
          </label>
        </div>

        <div className="panel">
          <h2>Źródła</h2>
          <p className="hint">
            LinkedIn i Pracuj.pl / theprotocol.it nie pozwalają na automatyczne wyszukiwanie, więc ich oferty przychodzą z <b>alertów e-mail</b>: Claude czyta je w Gmailu i dodaje na tablicę. Ustaw alerty na
            tych portalach na ten sam adres, który podłączysz do Claude.
          </p>
          <div className="checks" style={{ flexDirection: "column", alignItems: "flex-start" }}>
            <label>
              <input type="checkbox" checked={form.sources.justjoin} onChange={(e) => set("sources", { ...form.sources, justjoin: e.target.checked })} />
              Just Join IT – skan przez API
            </label>
            <label>
              <input type="checkbox" checked={form.sources.nofluff} onChange={(e) => set("sources", { ...form.sources, nofluff: e.target.checked })} />
              No Fluff Jobs – skan przez API
            </label>
            <label>
              <input type="checkbox" checked={form.sources.bulldogjob} onChange={(e) => set("sources", { ...form.sources, bulldogjob: e.target.checked })} />
              Bulldogjob – skan według technologii (pierwsze słowo frazy, np. „Kotlin”)
            </label>
            <label>
              <input type="checkbox" checked={form.sources.remotive} onChange={(e) => set("sources", { ...form.sources, remotive: e.target.checked })} />
              Remotive – praca zdalna z zagranicy (otwarta dla Polski / Europy)
            </label>
            <label>
              <input type="checkbox" checked={form.sources.himalayas} onChange={(e) => set("sources", { ...form.sources, himalayas: e.target.checked })} />
              Himalayas – praca zdalna z zagranicy (otwarta dla Polski / Europy)
            </label>
            <label>
              <input type="checkbox" checked={form.sources.linkedin} onChange={(e) => set("sources", { ...form.sources, linkedin: e.target.checked })} />
              LinkedIn – dodatkowo publiczna wyszukiwarka (bez logowania; eksperymentalnie, LinkedIn często ją blokuje)
            </label>
          </div>
        </div>

        <div className="savebar">
          {msg && <span className={msg.ok ? "ok" : "error"}>{msg.text}</span>}
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? "Zapisuję…" : "Zapisz ustawienia"}
          </button>
        </div>
      </div>
    </>
  );
}
