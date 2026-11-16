// Kelime Atlası sync server. Contract: docs/sync.md section 3.
export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
}

const MAX_DATA = 1_000_000;
const MAX_BODY = MAX_DATA + 1024;
const RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
const ID_RE = /^[0-9a-f]{32}$/;
const enc = new TextEncoder();

interface Row { auth_hash: string; rev: number; data: string; updated: number }

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match, If-None-Match",
    "Access-Control-Expose-Headers": "ETag",
    "Access-Control-Max-Age": "86400",
  };
}

function json(status: number, body: unknown, cors: Record<string, string>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors, ...extra },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Both inputs are fixed-length hex hashes; no early exit on mismatch.
function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i % (y.length || 1)] ?? 0);
  return diff === 0;
}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S{1,200})$/.exec(req.headers.get("Authorization") ?? "");
  return m ? m[1] : null;
}

function parseRev(v: string | null): number | null {
  const m = v ? /^(?:W\/)?"(\d{1,15})"$/.exec(v.trim()) : null;
  return m ? Number(m[1]) : null;
}

async function handleSync(req: Request, env: Env, id: string, cors: Record<string, string>): Promise<Response> {
  const token = bearer(req);
  if (!token) return json(401, { error: "unauthorized" }, cors);
  const hash = await sha256Hex(token);
  const getRow = () =>
    env.DB.prepare("SELECT auth_hash, rev, data, updated FROM sync WHERE id = ?").bind(id).first<Row>();

  if (req.method === "GET") {
    const row = await getRow();
    if (!row) return json(404, { error: "not_found" }, cors);
    if (!safeEqual(row.auth_hash, hash)) return json(401, { error: "unauthorized" }, cors);
    const etag = `"${row.rev}"`;
    const inm = req.headers.get("If-None-Match");
    if (inm && inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) {
      return new Response(null, { status: 304, headers: { ETag: etag, ...cors } });
    }
    return json(200, { rev: row.rev, data: row.data, updated: row.updated }, cors, { ETag: etag });
  }

  if (req.method === "DELETE") {
    const row = await getRow();
    if (!row) return json(404, { error: "not_found" }, cors);
    if (!safeEqual(row.auth_hash, hash)) return json(401, { error: "unauthorized" }, cors);
    await env.DB.prepare("DELETE FROM sync WHERE id = ? AND auth_hash = ?").bind(id, hash).run();
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "PUT") return json(405, { error: "method_not_allowed" }, cors, { Allow: "GET, PUT, DELETE, OPTIONS" });

  const create = req.headers.get("If-None-Match")?.trim() === "*";
  const ifMatch = req.headers.get("If-Match");
  const expected = parseRev(ifMatch);
  if (!create && (ifMatch === null || expected === null)) return json(400, { error: "precondition_required" }, cors);

  const len = Number(req.headers.get("Content-Length") ?? 0);
  if (len > MAX_BODY) return json(413, { error: "too_large" }, cors);
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { error: "too_large" }, cors);
  let data: unknown;
  try { data = (JSON.parse(text) as { data?: unknown }).data; } catch { return json(400, { error: "bad_body" }, cors); }
  if (typeof data !== "string" || data.length === 0) return json(400, { error: "bad_body" }, cors);
  if (data.length > MAX_DATA) return json(413, { error: "too_large" }, cors);

  const now = Date.now();
  if (create) {
    const r = await env.DB.prepare(
      "INSERT OR IGNORE INTO sync (id, auth_hash, rev, data, created, updated) VALUES (?, ?, 1, ?, ?, ?)",
    ).bind(id, hash, data, now, now).run();
    if (r.meta.changes > 0) return json(201, { rev: 1, updated: now }, cors);
    const row = await getRow();
    return json(412, { rev: row?.rev ?? null }, cors);
  }

  const r = await env.DB.prepare(
    "UPDATE sync SET data = ?, rev = rev + 1, updated = ? WHERE id = ? AND rev = ? AND auth_hash = ?",
  ).bind(data, now, id, expected, hash).run();
  if (r.meta.changes > 0) return json(200, { rev: (expected as number) + 1, updated: now }, cors);
  const row = await getRow();
  if (!row) return json(404, { error: "not_found" }, cors);
  if (!safeEqual(row.auth_hash, hash)) return json(401, { error: "unauthorized" }, cors);
  return json(412, { rev: row.rev }, cors);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req, env);
    try {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      const path = new URL(req.url).pathname;
      if (path === "/v1/health" && req.method === "GET") return json(200, { ok: true }, cors);
      const m = /^\/v1\/sync\/([^/]+)$/.exec(path);
      if (!m || !ID_RE.test(m[1])) return json(404, { error: "not_found" }, cors);
      return await handleSync(req, env, m[1], cors);
    } catch {
      return json(500, { error: "internal" }, cors);
    }
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await env.DB.prepare("DELETE FROM sync WHERE updated < ?").bind(Date.now() - RETENTION_MS).run();
  },
};
