"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "@/lib/types";
import type { BoardData } from "@/lib/view";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** A change to a card; nextStep null clears it. */
export type JobUpdate = Partial<Omit<Job, "nextStep" | "offered">> & { nextStep?: Job["nextStep"] | null; offered?: Job["offered"] | null };

const POLL_MS = 8000;

export interface UndoEntry {
  label: string;
  /** The previous values of the fields that changed, per job. */
  before: { id: string; patch: JobUpdate }[];
}

/**
 * The board's data: polled (Claude changes it through MCP in the background), with optimistic
 * updates and a one-step undo for the quick inbox actions.
 */
export function useBoard() {
  const [data, setData] = useState<BoardData>();
  const [error, setError] = useState<string>();
  const [undo, setUndo] = useState<UndoEntry>();
  const pending = useRef(0);

  const load = useCallback(async () => {
    if (pending.current) return;
    try {
      const d = await api<BoardData>("/api/jobs");
      setData((old) =>
        old && old.version === d.version && JSON.stringify(old.profile) === JSON.stringify(d.profile) && old.mailCheckedAt === d.mailCheckedAt
          ? old
          : d,
      );
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, POLL_MS);
    window.addEventListener("focus", load);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const send = useCallback(
    async (changes: { id: string; patch: JobUpdate }[]) => {
      setData((d) => d && { ...d, jobs: d.jobs.map((j) => ({ ...j, ...changes.find((c) => c.id === j.id)?.patch }) as Job) });
      pending.current++;
      try {
        for (const c of changes) {
          await api("/api/jobs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [c.id], patch: c.patch }) });
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        pending.current--;
        load();
      }
    },
    [load],
  );

  /** Changes cards; with `undoLabel` the change can be taken back from the toast (or with Z). */
  const update = useCallback(
    (ids: string[], patch: JobUpdate, undoLabel?: string) => {
      if (undoLabel && data) {
        const before = ids.map((id) => {
          const job = data.jobs.find((j) => j.id === id);
          const prev: JobUpdate = {};
          for (const k of Object.keys(patch) as (keyof JobUpdate)[]) (prev as Record<string, unknown>)[k] = job?.[k as keyof Job] ?? null;
          return { id, patch: prev };
        });
        setUndo({ label: undoLabel, before });
      }
      return send(ids.map((id) => ({ id, patch })));
    },
    [data, send],
  );

  const undoLast = useCallback(() => {
    if (!undo) return;
    setUndo(undefined);
    send(undo.before);
  }, [undo, send]);

  return { data, error, setError, load, update, undo, undoLast, dismissUndo: () => setUndo(undefined) };
}

export function saveOnboarding(onboarding: NonNullable<BoardData["profile"]["onboarding"]>) {
  return api("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onboarding }) });
}
