import assert from "node:assert/strict";
import { test } from "node:test";
import type { CardState } from "../store/srs";
import { defaultSettings, emptyProgress, type Progress, type TypingRound } from "../store/store";
import { applyDoc, buildDoc } from "./doc";
import { mergeDocs, type SyncDoc } from "./merge";

const card = (o: Partial<CardState> = {}): CardState => ({ due: 100, s: 2, d: 5, el: 0, sd: 1, ls: 0, reps: 1, lapses: 0, st: 2, last: 50, seen: 10, ...o });
const doc = (o: Partial<SyncDoc> = {}): SyncDoc => ({ v: 1, datasetId: "ds", updated: 1000, cards: {}, bookmarks: {}, mistakes: [], typing: [], devices: {}, settings: {}, ...o });
const prog = (o: Partial<Progress> = {}): Progress => ({ ...emptyProgress("ds"), ...o });
const round = (at: number, mode: TypingRound["mode"] = "word"): TypingRound => ({ at, mode, items: 1, wpm: 1, accuracy: 100 });

test("cards: larger last wins, then reps, then due; seen is the min", () => {
  const a = doc({ cards: { x: card({ last: 60, seen: 20, s: 1 }), y: card({ last: 50, reps: 3 }), z: card({ last: 50, reps: 3, due: 9 }), onlyA: card() } });
  const b = doc({ cards: { x: card({ last: 55, seen: 5, s: 9 }), y: card({ last: 50, reps: 2, due: 999 }), z: card({ last: 50, reps: 3, due: 10 }), onlyB: card() } });
  const m = mergeDocs(a, b);
  assert.equal(m.cards.x.s, 1);
  assert.equal(m.cards.x.seen, 5);
  assert.equal(m.cards.y.reps, 3);
  assert.equal(m.cards.z.due, 10);
  assert.deepEqual(Object.keys(m.cards).sort(), ["onlyA", "onlyB", "x", "y", "z"]);
  assert.equal(mergeDocs(card({ last: undefined }) && doc({ cards: { q: card({ last: undefined, s: 1 }) } }), doc({ cards: { q: card({ last: 1, s: 2 }) } })).cards.q.s, 2);
});

test("cards, bookmarks, typing and devices merges are commutative", () => {
  const a = doc({
    updated: 5,
    cards: { x: card({ last: 60 }), t: card({ last: 5, s: 1 }) },
    bookmarks: { p: 100, q: -300, r: 50 },
    typing: [round(9), round(5, "sentence")],
    devices: { A: { name: "A", updated: 7, days: { "2026-01-01": { n: 1, r: 1, c: 1, t: 1 } } }, C: { name: "c", updated: 1, days: {} } },
    settings: { dailyNew: 5 },
  });
  const b = doc({
    updated: 6,
    cards: { x: card({ last: 70, s: 8 }), t: card({ last: 5, s: 2 }) },
    bookmarks: { p: -200, q: 250, s: 1 },
    typing: [round(9), round(7)],
    devices: { A: { name: "A", updated: 3, days: {} }, B: { name: "B", updated: 4, days: {} } },
    settings: { dailyNew: 20 },
  });
  const ab = mergeDocs(a, b);
  const ba = mergeDocs(b, a);
  assert.deepEqual(ab.cards, ba.cards);
  assert.deepEqual(ab.bookmarks, ba.bookmarks);
  assert.deepEqual(ab.typing, ba.typing);
  assert.deepEqual(ab.devices, ba.devices);
  assert.deepEqual(ab.settings, ba.settings);
  assert.equal(ab.updated, 6);
  assert.deepEqual(ab.typing.map((t) => t.at), [9, 7, 5]);
  assert.equal(ab.bookmarks.p, -200); // abs 200 beats abs 100
});

test("bookmark: later toggle wins; removal stays removed", () => {
  // p: added at 100, removed at 200 on another device -> removed. q: removed at 300, re-added at 250 -> still removed.
  const m = mergeDocs(doc({ bookmarks: { p: 100, q: -300 } }), doc({ bookmarks: { p: -200, q: 250 } }));
  assert.equal(m.bookmarks.p, -200);
  assert.equal(m.bookmarks.q, -300);
  const local = prog({ bookmarks: ["p", "keep"], bookmarkTimes: { p: 100, keep: 1 } });
  const out = applyDoc(local, doc({ bookmarks: { p: -200, new: 400 } }), "me");
  assert.deepEqual(out.bookmarks, ["keep", "new"]);
  // A stale copy of the remote doc cannot resurrect it.
  const again = applyDoc(out, doc({ bookmarks: { p: 100 } }), "me");
  assert.ok(!again.bookmarks.includes("p"));
});

test("legacy bookmarks count as time 1", () => {
  const out = applyDoc(prog({ bookmarks: ["old"] }), doc({ bookmarks: { old: -2 } }), "me");
  assert.deepEqual(out.bookmarks, []);
  const kept = applyDoc(prog({ bookmarks: ["old"] }), doc({ bookmarks: { old: 1 } }), "me");
  assert.deepEqual(kept.bookmarks, ["old"]);
  const built = buildDoc(prog({ bookmarks: ["old"] }), defaultSettings, "me", "n");
  assert.equal(built.bookmarks.old, 1);
});

test("mistakes: local first, deduped, capped; typing: union by at|mode, newest first, capped", () => {
  const out = applyDoc(prog({ mistakes: ["a", "b"], typing: [round(1), round(3)] }), doc({ mistakes: ["b", "c"], typing: [round(3), round(3, "sentence"), round(2)] }), "me");
  assert.deepEqual(out.mistakes, ["a", "b", "c"]);
  assert.deepEqual(out.typing.map((t) => `${t.at}${t.mode[0]}`), ["1w", "2w", "3w", "3s"]); // Progress keeps oldest first (newest-first order is at desc, then mode)
  const many = Array.from({ length: 300 }, (_, i) => `m${i}`);
  assert.equal(mergeDocs(doc({ mistakes: many }), doc({ mistakes: [] })).mistakes.length, 300);
  const rounds = Array.from({ length: 250 }, (_, i) => round(i + 1));
  const m = mergeDocs(doc({ typing: rounds }), doc());
  assert.equal(m.typing.length, 200);
  assert.equal(m.typing[0].at, 250);
});

test("devices: larger updated wins; own entry is rebuilt from local days", () => {
  const own = { "2026-02-01": { n: 1, r: 4, c: 3, t: 20 } };
  const prev = doc({
    devices: {
      me: { name: "stale", updated: 9999, days: { "2026-02-01": { n: 0, r: 1, c: 1, t: 1 } } },
      other: { name: "Phone", updated: 5, days: { "2026-02-01": { n: 2, r: 6, c: 5, t: 30 } } },
    },
  });
  const built = buildDoc(prog({ days: own }), defaultSettings, "me", "Laptop", prev, 2000);
  assert.deepEqual(built.devices.me.days, own);
  assert.equal(built.devices.me.name, "Laptop");
  assert.equal(built.devices.other.name, "Phone");
});

test("days sum across devices", async () => {
  const { combinedDays } = await import("../store/store");
  const p = prog({
    days: { "2026-02-01": { n: 1, r: 4, c: 3, t: 20 } },
    otherDays: { a: { "2026-02-01": { n: 2, r: 6, c: 5, t: 30 }, "2026-02-02": { n: 1, r: 1, c: 1, t: 1 } }, b: { "2026-02-01": { n: 1, r: 1, c: 0, t: 5 } } },
  });
  const d = combinedDays(p);
  assert.deepEqual(d["2026-02-01"], { n: 4, r: 11, c: 8, t: 55 });
  assert.deepEqual(d["2026-02-02"], { n: 1, r: 1, c: 1, t: 1 });
  const out = applyDoc(prog(), doc({ devices: { me: { name: "me", updated: 1, days: { "2026-02-01": { n: 9, r: 9, c: 9, t: 9 } } }, a: { name: "A", updated: 1, days: { "2026-02-01": { n: 1, r: 2, c: 3, t: 4 } } } } }), "me");
  assert.deepEqual(Object.keys(out.otherDays), ["a"]); // never keeps a copy of itself
  assert.deepEqual(out.days, {});
});

test("another dataset's doc is ignored", () => {
  const p = prog({ cards: { x: card() } });
  assert.equal(applyDoc(p, doc({ datasetId: "other", cards: { y: card() } }), "me"), p);
  const a = doc({ cards: { x: card() } });
  assert.equal(mergeDocs(a, doc({ datasetId: "other", cards: { y: card() } })), a);
  const built = buildDoc(p, defaultSettings, "me", "n", doc({ datasetId: "other", cards: { y: card() } }));
  assert.deepEqual(Object.keys(built.cards), ["x"]);
});

test("active session loses later steps for words reviewed elsewhere since it started", () => {
  const steps = ["a", "b", "c", "d", "e"].map((id) => ({ id, kind: "meaning" as const }));
  const session = { id: "s", started: 1000, steps, index: 1, graded: {}, newIds: [], reviewIds: [] };
  const p = prog({ session, cards: { a: card({ last: 500 }), c: card({ last: 600 }) } });
  const remote = doc({
    cards: {
      a: card({ last: 2000 }), // current/earlier step: kept
      b: card({ last: 2000 }), // current step (index 1): kept
      c: card({ last: 2000 }), // later, reviewed elsewhere: removed
      d: card({ last: 900 }), // reviewed before the session began: kept
      e: card({ last: 3000 }), // new on remote: removed
    },
  });
  const out = applyDoc(p, remote, "me");
  assert.deepEqual(out.session!.steps.map((s) => s.id), ["a", "b", "d"]);
  assert.equal(out.session!.index, 1);
  // A review made locally during the session is not "from remote".
  const local = prog({ session, cards: { c: card({ last: 1500 }) } });
  const kept = applyDoc(local, doc({ cards: { c: card({ last: 1200 }) } }), "me");
  assert.equal(kept.session!.steps.length, 5);
  assert.equal(applyDoc(prog(), remote, "me").session, null);
});

test("buildDoc keeps the previous timestamp when nothing changed", () => {
  const p = prog({ cards: { x: card() } });
  const first = buildDoc(p, defaultSettings, "me", "n", null, 1000);
  const second = buildDoc(p, defaultSettings, "me", "n", first, 5000);
  assert.equal(second.updated, 1000);
  assert.equal(second.devices.me.updated, 1000);
  const third = buildDoc({ ...p, mistakes: ["x"] }, defaultSettings, "me", "n", first, 6000);
  assert.equal(third.updated, 6000);
});
