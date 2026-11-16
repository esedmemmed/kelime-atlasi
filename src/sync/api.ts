import { SYNC_URL } from "../config";

export const MAX_DATA_CHARS = 1_000_000;
/** Browsers cap keepalive request bodies at 64 kB; stay below that. */
export const KEEPALIVE_MAX = 60_000;

type Failure =
  | { status: "not-found" }
  | { status: "unauthorized" }
  | { status: "conflict"; rev: number }
  | { status: "too-large" }
  | { status: "error"; retryAfterMs?: number; /** fetch itself failed (no network). */ offline?: boolean };

export type GetResult = { status: "ok"; rev: number; data: string; updated: number } | { status: "not-modified" } | Failure;
export type WriteResult = { status: "ok"; rev: number; updated: number } | Failure;
export type RemoveResult = { status: "ok" } | Failure;

export interface ApiOptions {
  /** Base URL without a trailing slash; defaults to `SYNC_URL`. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Ask for a keepalive request (used while the page is being hidden). Ignored for bodies over 60 kB. */
  keepalive?: boolean;
}

const url = (o: ApiOptions | undefined, id: string) => `${o?.baseUrl ?? SYNC_URL}/v1/sync/${id}`;

async function call(o: ApiOptions | undefined, id: string, init: RequestInit): Promise<Response | null> {
  try {
    return await (o?.fetch ?? globalThis.fetch)(url(o, id), init);
  } catch {
    return null;
  }
}

function retryAfter(r: Response): number | undefined {
  const h = r.headers.get("retry-after");
  const n = h ? Number(h) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 3600) * 1000 : undefined;
}

async function json(r: Response): Promise<Record<string, unknown>> {
  try {
    const v = await r.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

async function failure(r: Response | null): Promise<Failure> {
  if (!r) return { status: "error" };
  if (r.status === 404) return { status: "not-found" };
  if (r.status === 401) return { status: "unauthorized" };
  if (r.status === 413) return { status: "too-large" };
  if (r.status === 412) return { status: "conflict", rev: num((await json(r)).rev) };
  return { status: "error", retryAfterMs: retryAfter(r) };
}

const headers = (auth: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${auth}`, ...extra });

export async function get(id: string, auth: string, rev?: number, o?: ApiOptions): Promise<GetResult> {
  const r = await call(o, id, { method: "GET", headers: headers(auth, rev ? { "If-None-Match": `"${rev}"` } : {}) });
  if (r?.status === 304) return { status: "not-modified" };
  if (r?.status === 200) {
    const b = await json(r);
    if (typeof b.data !== "string") return { status: "error" };
    return { status: "ok", rev: num(b.rev), data: b.data, updated: num(b.updated) };
  }
  return failure(r);
}

async function put(id: string, auth: string, precondition: Record<string, string>, data: string, o?: ApiOptions): Promise<WriteResult> {
  if (data.length > MAX_DATA_CHARS) return { status: "too-large" };
  const body = JSON.stringify({ data });
  const r = await call(o, id, {
    method: "PUT",
    headers: headers(auth, { "Content-Type": "application/json", ...precondition }),
    body,
    keepalive: !!o?.keepalive && body.length <= KEEPALIVE_MAX,
  });
  if (r && (r.status === 200 || r.status === 201)) {
    const b = await json(r);
    return { status: "ok", rev: num(b.rev), updated: num(b.updated) };
  }
  return failure(r);
}

/** Creates the row; a 412 (`conflict`) means it already exists. */
export const create = (id: string, auth: string, data: string, o?: ApiOptions) => put(id, auth, { "If-None-Match": "*" }, data, o);

export const update = (id: string, auth: string, rev: number, data: string, o?: ApiOptions) => put(id, auth, { "If-Match": `"${rev}"` }, data, o);

export async function remove(id: string, auth: string, o?: ApiOptions): Promise<RemoveResult> {
  const r = await call(o, id, { method: "DELETE", headers: headers(auth) });
  if (r?.status === 204) return { status: "ok" };
  return failure(r);
}
