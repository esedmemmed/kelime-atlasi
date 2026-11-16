import { normalizeCode } from "./code";

const SALT = "kelime-atlasi-sync-v1";
const ITERATIONS = 150_000;
const VERSION = 1;

const subtle = () => globalThis.crypto.subtle;

export interface Secrets {
  /** 32 lowercase hex characters: the server key. */
  id: string;
  /** base64url without padding: the bearer token. */
  auth: string;
  /** AES-GCM-256 key; never leaves the device. */
  key: CryptoKey;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const toBase64Url = (b: Uint8Array) => toBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function deriveSecrets(code: string): Promise<Secrets> {
  const material = await subtle().importKey("raw", new TextEncoder().encode(normalizeCode(code)), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(
    await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(SALT), iterations: ITERATIONS }, material, 512),
  );
  const key = await subtle().importKey("raw", bits.slice(32, 64), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { id: hex(bits.slice(0, 16)), auth: toBase64Url(bits.slice(16, 32)), key };
}

async function pipe(data: Uint8Array, stream: { writable: WritableStream; readable: ReadableStream }): Promise<Uint8Array<ArrayBuffer>> {
  const writer = stream.writable.getWriter();
  void writer.write(data as unknown as BufferSource as never).then(() => writer.close());
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const canGzip = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

/** Encrypts the document into `[version][flags][12-byte IV][AES-GCM ciphertext+tag]`, base64 (standard alphabet, padded). */
export async function encryptDoc(doc: unknown, key: CryptoKey, opts?: { gzip?: boolean }): Promise<string> {
  let body = new TextEncoder().encode(JSON.stringify(doc)) as Uint8Array<ArrayBuffer>;
  let flags = 0;
  if (opts?.gzip !== false && canGzip()) {
    try {
      body = await pipe(body, new CompressionStream("gzip"));
      flags = 1;
    } catch {
      body = new TextEncoder().encode(JSON.stringify(doc));
    }
  }
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, body as BufferSource));
  const out = new Uint8Array(2 + 12 + cipher.length);
  out[0] = VERSION;
  out[1] = flags;
  out.set(iv, 2);
  out.set(cipher, 14);
  return toBase64(out);
}

/** Throws when the blob is malformed, the key is wrong, or the data was tampered with. */
export async function decryptDoc<T = unknown>(blob: string, key: CryptoKey): Promise<T> {
  const raw = fromBase64(blob);
  if (raw.length < 2 + 12 + 16 || raw[0] !== VERSION || (raw[1] !== 0 && raw[1] !== 1)) throw new Error("bad-blob");
  const iv = raw.slice(2, 14);
  let body = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv }, key, raw.slice(14) as BufferSource)) as Uint8Array<ArrayBuffer>;
  if (raw[1] === 1) {
    if (!canGzip()) throw new Error("no-gzip");
    body = await pipe(body, new DecompressionStream("gzip"));
  }
  return JSON.parse(new TextDecoder().decode(body)) as T;
}
