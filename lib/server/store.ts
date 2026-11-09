import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PROFILE, type Db, type Profile } from "../types";

/**
 * Everything lives in one folder (JOBDECK_HOME, ~/.jobdeck by default), outside the repo:
 *   jobs.json     offers + scan log
 *   profile.json  search settings + CV text
 *   cv/           the uploaded CV file
 * The web app and the MCP server both read and write it, so every write takes a lock file.
 */
export function dataDir(): string {
  const dir = process.env.JOBDECK_HOME || path.join(os.homedir(), ".jobdeck");
  fs.mkdirSync(path.join(dir, "cv"), { recursive: true });
  return dir;
}

const file = (name: string) => path.join(dataDir(), name);

function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}

function writeJson(name: string, data: unknown) {
  const target = file(name);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  // Windows refuses to replace a file another process is reading for a moment: retry briefly.
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (e) {
      if (i >= 20) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cross-process lock: one writer at a time across the web app, the MCP server and the scan script. */
async function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const lock = file("jobdeck.lock");
  for (let i = 0; ; i++) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 15_000) fs.rmSync(lock, { force: true });
      } catch {
        /* removed meanwhile */
      }
      if (i > 400) throw new Error("JobDeck: dane są zablokowane przez inny proces, spróbuj ponownie.");
      await sleep(25);
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

const EMPTY_DB: Db = { version: 0, jobs: {}, scans: [] };

export function readDb(): Db {
  return readJson<Db>("jobs.json", EMPTY_DB);
}

/** Read-modify-write under the lock. `fn` changes the db in place and may return a result. */
export async function updateDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  return withLock(async () => {
    const db = readDb();
    const result = await fn(db);
    db.version = (db.version ?? 0) + 1;
    writeJson("jobs.json", db);
    return result;
  });
}

export function readProfile(): Profile {
  const p = readJson<Partial<Profile>>("profile.json", {});
  return { ...DEFAULT_PROFILE, ...p, sources: { ...DEFAULT_PROFILE.sources, ...p.sources } };
}

export async function updateProfile(fn: (p: Profile) => void): Promise<Profile> {
  return withLock(() => {
    const p = readProfile();
    fn(p);
    p.updatedAt = new Date().toISOString();
    writeJson("profile.json", p);
    return p;
  });
}

export function cvDir(): string {
  return path.join(dataDir(), "cv");
}

export function newId(): string {
  return crypto.randomBytes(5).toString("base64url");
}

export function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}
