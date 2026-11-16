import type { CardState } from "../store/srs";
import type { ActiveSession, Progress, Settings, TypingRound } from "../store/store";
import { docEqual, mergeBookmarks, mergeCard, mergeDocs, mergeMistakes, pickCard, unionTyping, MISTAKES_CAP, TYPING_CAP, type SyncDoc } from "./merge";

export type { SyncDoc } from "./merge";

/** The only settings that travel with the document (and only matter when a device joins). */
export const SYNCED_SETTINGS = ["accent", "autoplay", "dailyNew", "retention", "spell", "startLevel", "onboarded"] as const;

export function pickSettings(s: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const k of SYNCED_SETTINGS) out[k] = s[k];
  return out as Partial<Settings>;
}

/** Bookmark times as stored locally, with legacy bookmarks (no time) counted as time 1 and listed ids always positive. */
function localBookmarkTimes(p: Progress): Record<string, number> {
  const out = { ...p.bookmarkTimes };
  for (const id of p.bookmarks) if (out[id] === undefined) out[id] = 1;
  return out;
}

/**
 * Builds the document to upload: this device's data, merged with `previousDoc` (the latest remote doc) when given.
 * The own device entry is always rebuilt from local `Progress.days`.
 */
export function buildDoc(progress: Progress, settings: Settings, deviceId: string, deviceName: string, previousDoc?: SyncDoc | null, now = Date.now()): SyncDoc {
  const prevOwn = previousDoc?.datasetId === progress.datasetId ? previousDoc.devices[deviceId] : undefined;
  const sameOwn = !!prevOwn && prevOwn.name === deviceName && JSON.stringify(prevOwn.days) === JSON.stringify(progress.days);
  const local: SyncDoc = {
    v: 1,
    datasetId: progress.datasetId,
    updated: now,
    cards: { ...progress.cards },
    bookmarks: localBookmarkTimes(progress),
    mistakes: progress.mistakes.slice(0, MISTAKES_CAP),
    typing: unionTyping(progress.typing, []).slice(0, TYPING_CAP),
    devices: { [deviceId]: { name: deviceName, updated: sameOwn ? prevOwn!.updated : now, days: progress.days } },
    settings: pickSettings(settings),
  };
  if (!previousDoc || previousDoc.datasetId !== progress.datasetId) return local;
  const merged = mergeDocs(local, previousDoc);
  // The own entry is authoritative locally, whatever the remote copy says.
  merged.devices[deviceId] = local.devices[deviceId];
  if (docEqual(merged, previousDoc)) merged.updated = previousDoc.updated;
  else merged.updated = now;
  return merged;
}

/** Drops the steps after the current one for words that another device reviewed after this session started. */
function trimSession(session: ActiveSession | null, remoteReviewed: Set<string>): ActiveSession | null {
  if (!session || session.finished || !remoteReviewed.size) return session;
  const keep = session.steps.filter((st, i) => i <= session.index || !remoteReviewed.has(st.id));
  return keep.length === session.steps.length ? session : { ...session, steps: keep };
}

/** Merges a remote document into local progress. Returns the same object when the doc belongs to another dataset. */
export function applyDoc(progress: Progress, doc: SyncDoc, deviceId: string): Progress {
  if (doc.datasetId !== progress.datasetId) return progress;

  const cards: Record<string, CardState> = { ...progress.cards };
  const remoteReviewed = new Set<string>();
  const started = progress.session?.started ?? Infinity;
  for (const [id, remote] of Object.entries(doc.cards)) {
    const local = cards[id];
    if (!local) {
      cards[id] = remote;
      if ((remote.last ?? 0) > started) remoteReviewed.add(id);
    } else {
      const merged = mergeCard(local, remote);
      cards[id] = merged;
      if (pickCard(local, remote) === "b" && (remote.last ?? 0) !== (local.last ?? 0) && (merged.last ?? 0) > started) remoteReviewed.add(id);
    }
  }

  const times = mergeBookmarks(localBookmarkTimes(progress), doc.bookmarks);
  const bookmarks = progress.bookmarks.filter((id) => (times[id] ?? 0) > 0);
  for (const [id, t] of Object.entries(times)) if (t > 0 && !bookmarks.includes(id)) bookmarks.push(id);

  const typing: TypingRound[] = unionTyping(progress.typing, doc.typing).slice(0, 500).reverse();

  const otherDays = { ...progress.otherDays };
  for (const [id, dev] of Object.entries(doc.devices)) if (id !== deviceId) otherDays[id] = dev.days;

  return {
    ...progress,
    cards,
    bookmarks,
    bookmarkTimes: times,
    mistakes: mergeMistakes(progress.mistakes, doc.mistakes, MISTAKES_CAP),
    typing,
    otherDays,
    session: trimSession(progress.session, remoteReviewed),
  };
}
