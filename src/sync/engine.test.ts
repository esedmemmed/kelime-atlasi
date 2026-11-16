import assert from "node:assert/strict";
import { test } from "node:test";
import type { CardState } from "../store/srs";
import { defaultSettings, emptyProgress, type Progress, type Settings } from "../store/store";
import { createEngine, parseDeviceName, SYNC_KEY, type Engine, type StoreLike } from "./engine";
import { generateCode } from "./code";

const BASE = "https://sync.test";
const card = (o: Partial<CardState> = {}): CardState => ({ due: 100, s: 2, d: 5, el: 0, sd: 1, ls: 0, reps: 1, lapses: 0, st: 2, last: 50, seen: 10, ...o });

/** In-memory server implementing the spec statuses. */
function fakeServer() {
  const rows = new Map<string, { auth: string; rev: number; data: string; updated: number }>();
  const log: Array<{ method: string; status: number }> = [];
  const s = {
    rows,
    log,
    /** Runs before a PUT is processed (to simulate another device writing in between). */
    beforePut: null as null | (() => Promise<void>),
    forceStatus: 0,
    fetch: (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? "GET";
      const h = new Headers(init.headers);
      const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
        log.push({ method, status });
        return new Response(status === 204 || status === 304 ? null : JSON.stringify(body ?? {}), { status, headers });
      };
      if (s.forceStatus) return reply(s.forceStatus);
      const id = url.replace(`${BASE}/v1/sync/`, "");
      const auth = (h.get("authorization") ?? "").replace("Bearer ", "");
      const row = rows.get(id);
      if (method === "GET") {
        if (!row) return reply(404, { error: "not_found" });
        if (row.auth !== auth) return reply(401, { error: "unauthorized" });
        if (h.get("if-none-match") === `"${row.rev}"`) return reply(304);
        return reply(200, { rev: row.rev, data: row.data, updated: row.updated }, { ETag: `"${row.rev}"` });
      }
      if (method === "PUT") {
        if (s.beforePut) {
          const f = s.beforePut;
          s.beforePut = null;
          await f();
        }
        const { data } = JSON.parse(String(init.body));
        if (data.length > 1_000_000) return reply(413);
        if (h.get("if-none-match") === "*") {
          if (rows.get(id)) return reply(412, { rev: rows.get(id)!.rev });
          rows.set(id, { auth, rev: 1, data, updated: Date.now() });
          return reply(201, { rev: 1, updated: Date.now() });
        }
        const m = /^"(\d+)"$/.exec(h.get("if-match") ?? "");
        if (!m) return reply(400);
        const cur = rows.get(id);
        if (!cur) return reply(404);
        if (cur.auth !== auth) return reply(401);
        if (cur.rev !== Number(m[1])) return reply(412, { rev: cur.rev });
        cur.rev++;
        cur.data = data;
        cur.updated = Date.now();
        return reply(200, { rev: cur.rev, updated: cur.updated });
      }
      if (method === "DELETE") {
        if (!row) return reply(404);
        if (row.auth !== auth) return reply(401);
        rows.delete(id);
        return reply(204);
      }
      return reply(400);
    }) as typeof fetch,
  };
  return s;
}

function fakeDevice(server: ReturnType<typeof fakeServer>, name: string) {
  let progress: Progress = emptyProgress("ds");
  let settings: Settings = { ...defaultSettings };
  let version = 0;
  const local = new Set<() => void>();
  const fin = new Set<() => void>();
  const store: StoreLike = {
    get: () => ({ progress, settings }),
    applyRemote: (fn) => void (progress = fn(progress)),
    settings: (patch) => void (settings = { ...settings, ...patch }),
    localVersion: () => version,
    onLocalChange: (l) => (local.add(l), () => local.delete(l)),
    onSessionFinished: (l) => (fin.add(l), () => fin.delete(l)),
  };
  const mem = new Map<string, string>();
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let clock = 1_000_000;
  let nextId = 1;
  const engine: Engine = createEngine({
    baseUrl: BASE,
    fetch: server.fetch,
    store,
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) },
    now: () => clock,
    setTimeout: (fn, ms) => {
      const t = { at: clock + ms, fn, id: nextId++ };
      timers.push(t);
      return t.id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    deviceName: () => name,
    isVisible: () => true,
    randomId: () => `dev-${name}`,
  });
  return {
    engine,
    mem,
    timers,
    get progress() {
      return progress;
    },
    get settings() {
      return settings;
    },
    /** A local change, like store.progress(). */
    change(fn: (p: Progress) => Progress) {
      progress = fn(progress);
      version++;
      local.forEach((l) => l());
    },
    finishSession: () => fin.forEach((l) => l()),
    advance: async (ms: number) => {
      clock += ms;
      for (const t of timers.filter((x) => x.at <= clock).sort((a, b) => a.at - b.at)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}

test("parses device names", () => {
  assert.equal(parseDeviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120"), "Windows · Edge");
  assert.equal(parseDeviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"), "Android · Chrome");
  assert.equal(parseDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"), "iPhone · Safari");
});

test("create, join, push, pull, concurrent edits with a 412, and removal", async () => {
  const server = fakeServer();
  const A = fakeDevice(server, "Windows · Edge");
  const B = fakeDevice(server, "iPhone · Safari");

  A.change((p) => ({ ...p, cards: { x: card({ last: 100 }) }, days: { "2026-03-01": { n: 1, r: 2, c: 2, t: 10 } } }));
  const created = await A.engine.create();
  assert.ok(created.ok);
  const code = created.ok ? created.code : "";
  assert.equal(server.rows.size, 1);
  assert.equal(A.engine.getStatus().enabled, true);
  assert.equal(A.engine.getStatus().code, code);
  assert.equal(JSON.parse(A.mem.get(SYNC_KEY)!).enabled, true);
  // The server never sees the code or plaintext.
  const row = [...server.rows.values()][0];
  assert.ok(!row.data.includes("2026-03-01"));

  // Bad codes.
  assert.deepEqual(await B.engine.join("not a code"), { ok: false, error: "invalid-code" });
  assert.deepEqual(await B.engine.join(generateCode()), { ok: false, error: "not-found" });
  assert.equal(B.engine.getStatus().enabled, false);

  // B joins and sees A's data; its own settings adopt A's.
  A.engine.getStatus();
  assert.deepEqual(await B.engine.join(code.toUpperCase().replace(/-/g, " ")), { ok: true });
  assert.ok(B.progress.cards.x);
  assert.deepEqual(B.progress.otherDays[JSON.parse(A.mem.get(SYNC_KEY)!).deviceId]["2026-03-01"], { n: 1, r: 2, c: 2, t: 10 });
  assert.equal(B.engine.getStatus().enabled, true);
  assert.equal(B.engine.getStatus().error, undefined);
  assert.ok(B.engine.getStatus().lastSync);

  // A reviews a card and pushes when its throttle elapses; B pulls it.
  A.change((p) => ({ ...p, cards: { ...p.cards, y: card({ last: 200, reps: 2 }) } }));
  assert.equal(A.timers.length > 0, true, "push is scheduled");
  await A.advance(46_000);
  const revAfterA = [...server.rows.values()][0].rev;
  assert.equal(revAfterA, 3); // 1 create, 2 join (adds B device), 3 A push
  await B.advance(21_000);
  await B.engine.syncNow();
  assert.ok(B.progress.cards.y, "B sees A's review");
  assert.equal(A.engine._dirty(), false);

  // Both change at once: B's PUT hits a 412 because A writes in between; B retries and merges.
  A.change((p) => ({ ...p, cards: { ...p.cards, a1: card({ last: 300 }) }, bookmarks: ["w1"], bookmarkTimes: { w1: 300 } }));
  B.change((p) => ({ ...p, cards: { ...p.cards, b1: card({ last: 310 }) }, days: { "2026-03-02": { n: 0, r: 5, c: 4, t: 9 } } }));
  server.beforePut = async () => {
    await A.engine.syncNow();
  };
  const before = server.log.filter((l) => l.status === 412).length;
  await B.engine.syncNow();
  assert.equal(server.log.filter((l) => l.status === 412).length - before, 1);
  assert.ok(B.progress.cards.a1 && B.progress.cards.b1);
  assert.deepEqual(B.progress.bookmarks, ["w1"]);
  await A.engine.syncNow();
  assert.ok(A.progress.cards.b1 && A.progress.cards.a1);
  assert.deepEqual(A.progress.otherDays["dev-iPhone · Safari"]["2026-03-02"], { n: 0, r: 5, c: 4, t: 9 });
  assert.equal(B.engine.getStatus().error, undefined);

  // A finished session pushes right away, no throttle.
  A.change((p) => ({ ...p, cards: { ...p.cards, z: card({ last: 400 }) } }));
  A.finishSession();
  await A.advance(0);
  assert.ok(JSON.stringify([...server.rows.values()][0]).length > 0);
  await B.advance(21_000);
  await B.engine.syncNow();
  assert.ok(B.progress.cards.z);

  // The row disappears (deleted elsewhere): the next sync marks it removed and stops.
  server.rows.clear();
  await B.engine.syncNow();
  assert.equal(B.engine.getStatus().error, "removed");
  const calls = server.log.length;
  await B.engine.syncNow();
  assert.equal(server.log.length, calls, "no requests after removal");
  assert.ok(B.progress.cards.z, "local progress is untouched");
  B.engine.disable();
  assert.equal(B.engine.getStatus().enabled, false);
  assert.equal(B.mem.has(SYNC_KEY), false);
});

test("401 marks the code removed; delete from server turns sync off; errors back off", async () => {
  const server = fakeServer();
  const A = fakeDevice(server, "A");
  assert.ok((await A.engine.create()).ok);

  server.forceStatus = 500;
  A.change((p) => ({ ...p, mistakes: ["m"] }));
  await A.engine.syncNow();
  assert.equal(A.engine.getStatus().error, "server");
  assert.equal(A.engine.getStatus().enabled, true);
  // During backoff a plain trigger does nothing, but retry is scheduled at 30 s.
  const n = server.log.length;
  A.change((p) => ({ ...p, mistakes: ["m2"] }));
  await A.advance(2000);
  assert.equal(server.log.length, n);
  server.forceStatus = 0;
  await A.advance(31_000);
  assert.equal(A.engine.getStatus().error, undefined);

  server.forceStatus = 401;
  await A.engine.syncNow();
  assert.equal(A.engine.getStatus().error, "removed");
  assert.equal(A.engine.getStatus().enabled, true);
  server.forceStatus = 0;

  const B = fakeDevice(server, "B");
  assert.ok((await B.engine.create()).ok);
  const rows = server.rows.size;
  assert.deepEqual(await B.engine.deleteFromServer(), { ok: true });
  assert.equal(server.rows.size, rows - 1);
  assert.equal(B.engine.getStatus().enabled, false);
});
