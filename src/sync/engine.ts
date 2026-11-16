import { useSyncExternalStore } from "react";
import { SYNC_URL } from "../config";
import { store as realStore, type Progress, type Settings } from "../store/store";
import * as realApi from "./api";
import { MAX_DATA_CHARS, KEEPALIVE_MAX } from "./api";
import { generateCode, isValidCode, normalizeCode } from "./code";
import { decryptDoc, deriveSecrets, encryptDoc, type Secrets } from "./crypto";
import { applyDoc, buildDoc, pickSettings } from "./doc";
import { docEqual, type SyncDoc } from "./merge";

export const SYNC_KEY = "word-atlas:sync";

export const THROTTLE_MS = 45_000;
export const PULL_EVERY_MS = 120_000;
export const PULL_MIN_GAP_MS = 20_000;
export const BACKOFF_MIN_MS = 30_000;
export const BACKOFF_MAX_MS = 600_000;
const MAX_RETRIES = 2;

export type SyncError = "invalid-code" | "not-found" | "offline" | "server" | "removed" | "too-large";

export interface SyncStatus {
  enabled: boolean;
  code?: string;
  lastSync?: number;
  syncing: boolean;
  error?: SyncError;
}

interface StoredState {
  code: string;
  id: string;
  rev: number;
  lastSync: number;
  lastError?: string;
  deviceId: string;
  deviceName: string;
  enabled: true;
}

/** What the engine needs from the progress store. The real store satisfies it; tests pass a fake. */
export interface StoreLike {
  get(): { progress: Progress; settings: Settings };
  applyRemote(fn: (p: Progress) => Progress): void;
  settings(patch: Partial<Settings>): void;
  localVersion(): number;
  onLocalChange(l: () => void): () => void;
  onSessionFinished(l: () => void): () => void;
}

export interface EngineDeps {
  baseUrl: string;
  fetch?: typeof fetch;
  store: StoreLike;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
  deviceName: () => string;
  isVisible: () => boolean;
  /** Attach page-level listeners (visibility, focus, pagehide); returns a detach function. Optional. */
  attach?: (h: { visible: () => void; hidden: () => void; focus: () => void }) => () => void;
  randomId?: () => string;
}

export type JoinResult = { ok: true } | { ok: false; error: "invalid-code" | "not-found" | "offline" | "server" };
export type CreateResult = { ok: true; code: string } | { ok: false; error: "offline" | "server" | "too-large" };

/** "Windows · Edge", "Android · Chrome", "iPhone · Safari". */
export function parseDeviceName(ua: string): string {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : "Cihaz";
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung"
        : /Firefox\/|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Tarayıcı";
  return `${os} · ${browser}`;
}

const uuid = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));

export function createEngine(deps: EngineDeps) {
  const api = { baseUrl: deps.baseUrl, fetch: deps.fetch } satisfies realApi.ApiOptions;
  const store = deps.store;

  let st: StoredState | null = null;
  let secrets: Secrets | null = null;
  let lastRemote: SyncDoc | null = null;
  let started = false;
  let starting = false;
  let stopped = false; // removed on the server: stop syncing
  let syncing = false;
  let error: SyncError | undefined;
  let lastPullAt = 0;
  let lastPushAt = 0;
  let pushTimer: unknown = null;
  let pullTimer: unknown = null;
  let retryTimer: unknown = null;
  let backoffUntil = 0;
  let failures = 0;
  /** Local version up to which everything has been synced. -1 = unknown, so the first sync after start always compares. */
  let syncedVersion = -1;
  let queue: Promise<unknown> = Promise.resolve();
  let detach: (() => void) | null = null;
  let unsubs: Array<() => void> = [];
  let status: SyncStatus = { enabled: false, syncing: false };
  const subs = new Set<() => void>();

  const load = (): StoredState | null => {
    try {
      const raw = deps.storage.getItem(SYNC_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as Partial<StoredState>;
      if (v && v.enabled && typeof v.code === "string" && typeof v.id === "string" && typeof v.deviceId === "string") {
        return { code: v.code, id: v.id, rev: Number(v.rev) || 0, lastSync: Number(v.lastSync) || 0, lastError: v.lastError, deviceId: v.deviceId, deviceName: String(v.deviceName ?? ""), enabled: true };
      }
    } catch {
      /* corrupt state: treated as off */
    }
    return null;
  };
  const save = () => {
    try {
      if (st) deps.storage.setItem(SYNC_KEY, JSON.stringify(st));
      else deps.storage.removeItem(SYNC_KEY);
    } catch {
      /* storage full or blocked */
    }
  };

  function publish() {
    const next: SyncStatus = st
      ? { enabled: true, code: st.code, lastSync: st.lastSync || undefined, syncing, error }
      : { enabled: false, syncing: false };
    if (JSON.stringify(next) === JSON.stringify(status)) return;
    status = next;
    subs.forEach((l) => l());
  }

  const clearTimers = () => {
    for (const t of [pushTimer, pullTimer, retryTimer]) if (t !== null) deps.clearTimeout(t);
    pushTimer = pullTimer = retryTimer = null;
  };

  const isDirty = () => syncedVersion !== store.localVersion();

  function fail(kind: "unauthorized" | "not-found" | "error" | "too-large", e?: { retryAfterMs?: number; offline?: boolean }) {
    if (kind === "unauthorized" || kind === "not-found") {
      stopped = true;
      error = "removed";
      if (st) st.lastError = "removed";
      save();
      clearTimers();
      return;
    }
    if (kind === "too-large") {
      error = "too-large";
      return;
    }
    failures++;
    const wait = Math.max(e?.retryAfterMs ?? 0, Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (failures - 1)));
    backoffUntil = deps.now() + wait;
    error = e?.offline || navigatorOffline() ? "offline" : "server";
    if (retryTimer !== null) deps.clearTimeout(retryTimer);
    retryTimer = deps.setTimeout(() => {
      retryTimer = null;
      void run("push", {});
    }, wait);
  }
  const navigatorOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

  function succeed() {
    failures = 0;
    backoffUntil = 0;
    if (error !== "too-large") error = undefined;
    if (st) {
      st.lastSync = deps.now();
      st.lastError = undefined;
    }
  }

  /** Decrypts and applies a remote document to local progress. Returns the doc, or null when it can't be used. */
  async function takeRemote(data: string): Promise<SyncDoc | null> {
    let doc: SyncDoc;
    try {
      doc = await decryptDoc<SyncDoc>(data, secrets!.key);
    } catch {
      fail("error");
      error = "server"; // undecryptable blob: not a connectivity problem
      return null;
    }
    if (!doc || doc.v !== 1 || typeof doc.datasetId !== "string") return null;
    lastRemote = doc;
    if (doc.datasetId === store.get().progress.datasetId) store.applyRemote((p) => applyDoc(p, doc, st!.deviceId));
    return doc;
  }

  type Step = { ok: true } | { ok: false };

  /** GET + merge. Returns whether the sync may continue. */
  async function pull(force: boolean): Promise<Step> {
    if (!force && deps.now() - lastPullAt < PULL_MIN_GAP_MS) return { ok: true };
    const r = await realApi.get(st!.id, secrets!.auth, lastRemote ? st!.rev : undefined, api);
    if (r.status === "not-modified") {
      lastPullAt = deps.now();
      return { ok: true };
    }
    if (r.status === "ok") {
      lastPullAt = deps.now();
      const doc = await takeRemote(r.data);
      if (!doc) return { ok: false };
      st!.rev = r.rev;
      save();
      return { ok: true };
    }
    fail(r.status === "conflict" ? "error" : r.status, r.status === "error" ? r : undefined);
    return { ok: false };
  }

  /** Full push: pull, merge, PUT; on 412 pull, merge and retry. */
  async function pushFlow(opts: { skipPull?: boolean; keepalive?: boolean; force?: boolean }): Promise<void> {
    const version = store.localVersion();
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (!(opts.skipPull && attempt === 0)) {
        const p = await pull(true);
        if (!p.ok) return;
      }
      const { progress, settings } = store.get();
      if (lastRemote && lastRemote.datasetId !== progress.datasetId) return; // other dataset: ignore the doc, don't overwrite it
      const doc = buildDoc(progress, settings, st!.deviceId, st!.deviceName, lastRemote, deps.now());
      if (lastRemote && docEqual(doc, lastRemote)) {
        syncedVersion = version;
        succeed();
        return;
      }
      const blob = await encryptDoc(doc, secrets!.key);
      if (blob.length > MAX_DATA_CHARS) return fail("too-large");
      const r = await realApi.update(st!.id, secrets!.auth, st!.rev, blob, { ...api, keepalive: opts.keepalive });
      if (r.status === "ok") {
        st!.rev = r.rev;
        lastRemote = doc;
        lastPushAt = deps.now();
        syncedVersion = version;
        succeed();
        save();
        return;
      }
      if (r.status === "conflict") {
        // Someone else wrote first: pull and merge again (skipPull no longer applies).
        opts = { ...opts, skipPull: false };
        st!.rev = r.rev;
        lastRemote = null;
        if (attempt === MAX_RETRIES) return fail("error");
        continue;
      }
      return fail(r.status, r.status === "error" ? r : undefined);
    }
  }

  function run(kind: "pull" | "push", opts: { force?: boolean; keepalive?: boolean; skipPull?: boolean }): Promise<void> {
    const job = queue.then(async () => {
      if (!st || !secrets || stopped) return;
      if (!opts.force && deps.now() < backoffUntil) return;
      if (kind === "pull" && !opts.force && deps.now() - lastPullAt < PULL_MIN_GAP_MS) return;
      syncing = true;
      publish();
      try {
        if (kind === "pull") {
          const r = await pull(!!opts.force);
          if (r.ok) succeed();
          // Local work that was waiting (e.g. after start) goes out on the normal throttle.
          if (r.ok && isDirty()) schedulePush();
        } else {
          await pushFlow(opts);
        }
      } catch {
        fail("error", { offline: true });
      } finally {
        syncing = false;
        save();
        publish();
      }
    });
    queue = job.catch(() => undefined);
    return job;
  }

  function schedulePush() {
    if (!st || stopped || pushTimer !== null) return;
    const delay = Math.max(1000, lastPushAt + THROTTLE_MS - deps.now());
    pushTimer = deps.setTimeout(() => {
      pushTimer = null;
      if (isDirty()) void run("push", {});
    }, delay);
  }

  function schedulePullLoop() {
    if (pullTimer !== null) deps.clearTimeout(pullTimer);
    pullTimer = deps.setTimeout(() => {
      pullTimer = null;
      if (st && !stopped) {
        if (deps.isVisible()) void run("pull", {});
        schedulePullLoop();
      }
    }, PULL_EVERY_MS);
  }

  function begin() {
    if (started) return;
    started = true;
    unsubs = [
      store.onLocalChange(() => {
        if (st && !stopped) schedulePush();
      }),
      store.onSessionFinished(() => {
        if (!st || stopped) return;
        if (pushTimer !== null) {
          deps.clearTimeout(pushTimer);
          pushTimer = null;
        }
        void run("push", {});
      }),
    ];
    detach =
      deps.attach?.({
        visible: () => void run("pull", {}),
        focus: () => void run("pull", {}),
        hidden: () => {
          if (!st || stopped) return;
          if (pushTimer !== null) {
            deps.clearTimeout(pushTimer);
            pushTimer = null;
          }
          // The page may die any moment: no pull first, and keepalive when the body is small enough.
          if (isDirty()) void run("push", { skipPull: !!lastRemote, keepalive: true, force: true });
        },
      }) ?? null;
    schedulePullLoop();
  }

  function end() {
    started = false;
    clearTimers();
    unsubs.forEach((u) => u());
    unsubs = [];
    detach?.();
    detach = null;
  }

  function reset() {
    st = null;
    secrets = null;
    lastRemote = null;
    stopped = false;
    syncing = false;
    error = undefined;
    syncedVersion = -1;
    failures = 0;
    backoffUntil = 0;
    lastPullAt = 0;
    lastPushAt = 0;
    end();
    save();
    publish();
  }

  const newState = (code: string, id: string, rev: number): StoredState => ({
    code,
    id,
    rev,
    lastSync: deps.now(),
    deviceId: (deps.randomId ?? uuid)(),
    deviceName: deps.deviceName(),
    enabled: true,
  });

  async function startInner() {
    st = load();
    if (!st) return publish();
    stopped = st.lastError === "removed";
    error = stopped ? "removed" : undefined;
    try {
      secrets = await deriveSecrets(st.code);
    } catch {
      return reset();
    }
    begin();
    publish();
    if (!stopped) void run("push", { force: true });
  }

  return {
    getStatus: () => status,
    subscribe(l: () => void) {
      subs.add(l);
      return () => subs.delete(l);
    },

    /** Idempotent. Loads the stored state and starts the triggers. */
    async start(): Promise<void> {
      if (!deps.baseUrl || started || starting) return;
      starting = true;
      try {
        await startInner();
      } finally {
        starting = false;
      }
    },

    async create(): Promise<CreateResult> {
      if (!deps.baseUrl) return { ok: false, error: "server" };
      if (st) reset();
      for (let i = 0; i < 3; i++) {
        const code = generateCode();
        const s = await deriveSecrets(code);
        const { progress, settings } = store.get();
        const next = newState(code, s.id, 1);
        const doc = buildDoc(progress, settings, next.deviceId, next.deviceName, null, deps.now());
        const blob = await encryptDoc(doc, s.key);
        if (blob.length > MAX_DATA_CHARS) return { ok: false, error: "too-large" };
        const version = store.localVersion();
        const r = await realApi.create(s.id, s.auth, blob, api);
        if (r.status === "conflict") continue; // that code already exists: pick another
        if (r.status === "too-large") return { ok: false, error: "too-large" };
        if (r.status !== "ok") return { ok: false, error: r.status === "error" ? (navigatorOffline() ? "offline" : "server") : "server" };
        st = { ...next, rev: r.rev, lastSync: deps.now() };
        secrets = s;
        lastRemote = doc;
        stopped = false;
        error = undefined;
        syncedVersion = version;
        save();
        begin();
        publish();
        return { ok: true, code };
      }
      return { ok: false, error: "server" };
    },

    async join(input: string): Promise<JoinResult> {
      if (!deps.baseUrl) return { ok: false, error: "server" };
      const code = normalizeCode(input);
      if (!isValidCode(code)) return { ok: false, error: "invalid-code" };
      const s = await deriveSecrets(code);
      const r = await realApi.get(s.id, s.auth, undefined, api);
      if (r.status === "not-found") return { ok: false, error: "not-found" };
      if (r.status === "unauthorized") return { ok: false, error: "not-found" };
      if (r.status !== "ok") return { ok: false, error: r.status === "error" ? (navigatorOffline() ? "offline" : "server") : "server" };
      let doc: SyncDoc;
      try {
        doc = await decryptDoc<SyncDoc>(r.data, s.key);
      } catch {
        return { ok: false, error: "server" };
      }
      if (st) reset();
      st = newState(code, s.id, r.rev);
      secrets = s;
      lastRemote = doc;
      stopped = false;
      error = undefined;
      syncedVersion = -1;
      if (doc.datasetId === store.get().progress.datasetId) {
        store.applyRemote((p) => applyDoc(p, doc, st!.deviceId));
        const patch = pickSettings({ ...store.get().settings, ...doc.settings });
        store.settings(patch);
      }
      lastPullAt = deps.now();
      save();
      begin();
      publish();
      await run("push", { force: true, skipPull: true });
      return { ok: true };
    },

    syncNow: () => run("push", { force: true }),
    /** Pull only (used before a learning session starts); respects the 20 s minimum gap. */
    pullNow: () => run("pull", {}),

    /** Turn off on this device: progress stays, server data is untouched. */
    disable() {
      reset();
    },

    /** Delete the server copy, then turn off. */
    async deleteFromServer(): Promise<{ ok: boolean; error?: "offline" | "server" }> {
      if (!st || !secrets) return { ok: true };
      const r = await realApi.remove(st.id, secrets.auth, api);
      if (r.status === "error") return { ok: false, error: navigatorOffline() ? "offline" : "server" };
      reset(); // ok, 404 (already gone) and 401 (not ours any more) all end in "off"
      return { ok: true };
    },

    stop: end,
    /** For tests and devtools. */
    _dirty: isDirty,
    _state: () => st,
    _keepaliveMax: KEEPALIVE_MAX,
  };
}

export type Engine = ReturnType<typeof createEngine>;

/* ---------- default instance bound to the real app ---------- */

let instance: Engine | null = null;

function engine(): Engine {
  if (!instance) {
    instance = createEngine({
      baseUrl: SYNC_URL,
      store: realStore,
      storage: localStorage,
      now: () => Date.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (t) => window.clearTimeout(t as number),
      deviceName: () => parseDeviceName(navigator.userAgent),
      isVisible: () => document.visibilityState !== "hidden",
      attach: (h) => {
        const onVis = () => (document.visibilityState === "hidden" ? h.hidden() : h.visible());
        document.addEventListener("visibilitychange", onVis);
        window.addEventListener("pagehide", h.hidden);
        window.addEventListener("focus", h.focus);
        return () => {
          document.removeEventListener("visibilitychange", onVis);
          window.removeEventListener("pagehide", h.hidden);
          window.removeEventListener("focus", h.focus);
        };
      },
    });
    instance.subscribe(() => notify());
  }
  return instance;
}

const hooks = new Set<() => void>();
const notify = () => hooks.forEach((l) => l());
const off: SyncStatus = { enabled: false, syncing: false };
const subscribe = (l: () => void) => {
  hooks.add(l);
  return () => hooks.delete(l);
};

/** Idempotent; does nothing when `SYNC_URL` is empty. */
export function startSync(): void {
  if (!SYNC_URL || typeof window === "undefined") return;
  void engine().start();
}
export const createSync = () => engine().create();
export const joinSync = (code: string) => engine().join(code);
export const syncNow = () => (SYNC_URL ? engine().syncNow() : Promise.resolve());
/** Pull before a learning session starts (cheap 304 when nothing changed). */
export const pullBeforeSession = () => (SYNC_URL && instance ? instance.pullNow() : Promise.resolve());
export const disableSync = () => engine().disable();
export const deleteSyncFromServer = () => engine().deleteFromServer();
export const getSyncStatus = (): SyncStatus => (SYNC_URL && instance ? instance.getStatus() : off);

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSyncStatus, () => off);
}
