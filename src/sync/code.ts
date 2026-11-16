import { WORDS } from "./words";

const WORD_SET = new Set<string>(WORDS);

/** Unbiased random integer in [0, n) using rejection sampling over crypto.getRandomValues. */
function randomInt(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** Four words from the fixed list plus a 4-digit number, e.g. `river-lamp-green-cloud-4821`. */
export function generateCode(): string {
  const words = Array.from({ length: 4 }, () => WORDS[randomInt(WORDS.length)]);
  return `${words.join("-")}-${String(randomInt(10000)).padStart(4, "0")}`;
}

/** Trim, lowercase, collapse every run of non-[a-z0-9] into "-", trim "-" from both ends. */
export function normalizeCode(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Valid = 4 known words followed by exactly 4 digits (after normalization). */
export function isValidCode(s: string): boolean {
  const parts = normalizeCode(s).split("-");
  if (parts.length !== 5) return false;
  return parts.slice(0, 4).every((w) => WORD_SET.has(w)) && /^\d{4}$/.test(parts[4]);
}
