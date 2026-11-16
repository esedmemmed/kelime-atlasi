import type { CardState } from "../store/srs";
import type { DayStat, Settings, TypingRound } from "../store/store";

export const MISTAKES_CAP = 300;
export const TYPING_CAP = 200;

export interface SyncDevice {
  name: string;
  updated: number;
  days: Record<string, DayStat>;
}

export interface SyncDoc {
  v: 1;
  datasetId: string;
  updated: number;
  cards: Record<string, CardState>;
  bookmarks: Record<string, number>;
  mistakes: string[];
  typing: TypingRound[];
  devices: Record<string, SyncDevice>;
  settings: Partial<Settings>;
}

const canon = (v: unknown) => JSON.stringify(v);

/** Which side's card wins: larger `last`, then larger `reps`, then larger `due`, then a stable JSON order. Returns "a" or "b". */
export function pickCard(a: CardState, b: CardState): "a" | "b" {
  if ((a.last ?? 0) !== (b.last ?? 0)) return (a.last ?? 0) > (b.last ?? 0) ? "a" : "b";
  if (a.reps !== b.reps) return a.reps > b.reps ? "a" : "b";
  if (a.due !== b.due) return a.due > b.due ? "a" : "b";
  return canon(a) >= canon(b) ? "a" : "b";
}

export function mergeCard(a: CardState, b: CardState): CardState {
  const win = pickCard(a, b) === "a" ? a : b;
  return { ...win, seen: Math.min(a.seen, b.seen) };
}

export function mergeCards(a: Record<string, CardState>, b: Record<string, CardState>): Record<string, CardState> {
  const out: Record<string, CardState> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[id] = a[id] && b[id] ? mergeCard(a[id], b[id]) : { ...(a[id] ?? b[id]) };
  }
  return out;
}

/** The entry with the larger abs(time) wins; on an equal abs, the positive (bookmarked) one. */
export function mergeBookmarks(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id];
    const y = b[id];
    if (x === undefined) out[id] = y;
    else if (y === undefined) out[id] = x;
    else out[id] = Math.abs(x) !== Math.abs(y) ? (Math.abs(x) > Math.abs(y) ? x : y) : Math.max(x, y);
  }
  return out;
}

/** Union of both lists, deduped. First list first (callers pass local first when order matters). */
export function mergeMistakes(a: string[], b: string[], cap = MISTAKES_CAP): string[] {
  return [...new Set([...a, ...b])].slice(0, cap);
}

const typingKey = (t: TypingRound) => `${t.at}|${t.mode}`;
const typingOrder = (a: TypingRound, b: TypingRound) => b.at - a.at || (a.mode < b.mode ? -1 : a.mode > b.mode ? 1 : 0);

/** Union by `at|mode`, newest first. */
export function unionTyping(a: TypingRound[], b: TypingRound[]): TypingRound[] {
  const map = new Map<string, TypingRound>();
  for (const t of [...a, ...b]) {
    const k = typingKey(t);
    const prev = map.get(k);
    if (!prev || canon(t) < canon(prev)) map.set(k, t);
  }
  return [...map.values()].sort(typingOrder);
}

export function mergeDevices(a: Record<string, SyncDevice>, b: Record<string, SyncDevice>): Record<string, SyncDevice> {
  const out: Record<string, SyncDevice> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id];
    const y = b[id];
    if (!x || !y) out[id] = (x ?? y)!;
    else if (x.updated !== y.updated) out[id] = x.updated > y.updated ? x : y;
    else out[id] = canon(x) >= canon(y) ? x : y;
  }
  return out;
}

/**
 * Pure, deterministic merge of two sync documents. Cards, bookmarks, typing and devices are commutative.
 * Documents of different datasets are not merged: `a` is returned unchanged.
 */
export function mergeDocs(a: SyncDoc, b: SyncDoc): SyncDoc {
  if (a.datasetId !== b.datasetId) return a;
  const newer = a.updated !== b.updated ? (a.updated > b.updated ? a : b) : canon(a.settings) >= canon(b.settings) ? a : b;
  return {
    v: 1,
    datasetId: a.datasetId,
    updated: Math.max(a.updated, b.updated),
    cards: mergeCards(a.cards, b.cards),
    bookmarks: mergeBookmarks(a.bookmarks, b.bookmarks),
    mistakes: mergeMistakes(a.mistakes, b.mistakes),
    typing: unionTyping(a.typing, b.typing).slice(0, TYPING_CAP),
    devices: mergeDevices(a.devices, b.devices),
    settings: { ...newer.settings },
  };
}

/** True when two docs carry the same data; `updated` timestamps and `settings` are ignored. */
export function docEqual(a: SyncDoc, b: SyncDoc): boolean {
  const strip = (d: SyncDoc) => {
    const devices: Record<string, unknown> = {};
    for (const [id, dev] of Object.entries(d.devices)) devices[id] = { name: dev.name, days: dev.days };
    return canon({ ds: d.datasetId, c: d.cards, b: d.bookmarks, m: d.mistakes, t: d.typing, d: devices });
  };
  return strip(a) === strip(b);
}
