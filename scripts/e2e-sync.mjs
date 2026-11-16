// End-to-end test of cross-device sync: local worker + Vite dev server + two isolated browser contexts.
// Run with `npm run test:e2e-sync`. Screenshots go to $TEMP/kelime-sync-e2e.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, "sync-worker");
const EDGE = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
// Set E2E_APP and E2E_API to test a deployed site and worker instead of starting local servers.
const LIVE = !!process.env.E2E_APP;
const API = process.env.E2E_API || "http://localhost:8787";
const APP = (process.env.E2E_APP || "http://localhost:5199").replace(/\/$/, "");
const SHOTS = join(process.env.TEMP || tmpdir(), "kelime-sync-e2e");
mkdirSync(SHOTS, { recursive: true });

const index = JSON.parse(readFileSync(join(root, "public", "atlas", "index.json"), "utf8"));
const W = index.words.slice(0, 10).map((r) => ({ id: r[0], word: r[1] }));
const DATASET = index.id;

const children = [];
function killAll() {
  for (const c of children) {
    if (c.exitCode !== null) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill("SIGKILL");
  }
}
process.on("exit", killAll);

async function waitFor(url, what, child) {
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    if (child.exitCode !== null) throw new Error(`${what} exited early`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} did not become ready`);
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push([name, true]);
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push([name, false, e]);
    console.log(`  FAIL  ${name}\n        ${String(e.message || e).split("\n")[0]}`);
    throw e;
  }
}
const ok = (c, msg) => {
  if (!c) throw new Error(msg);
};

const readLS = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), key);
const progress = (page) => readLS(page, `word-atlas:v2:${DATASET}`);
const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 15000 }).catch(() => Promise.reject(new Error(`timeout: ${what}`)));
const goto = (page, hash) => page.evaluate((h) => (location.hash = h), hash);

/** Wait until stored bookmarks satisfy the predicate (store saves are debounced). */
const bookmarks = (page, ids, what) =>
  until(
    page,
    ([key, want]) => {
      const p = JSON.parse(localStorage.getItem(key) || "null");
      return !!p && want.every((id) => p.bookmarks.includes(id));
    },
    [`word-atlas:v2:${DATASET}`, ids],
    what,
  );

async function bookmarkWord(page, w) {
  await goto(page, `#/w/${w.id}`);
  const btn = page.getByRole("button", { name: "Kaydet", exact: true });
  await btn.waitFor({ timeout: 15000 });
  await btn.click();
  await page.getByRole("button", { name: "Kayıttan çıkar" }).waitFor();
}
async function isBookmarkedInUI(page, w) {
  await goto(page, `#/w/${w.id}`);
  await page.getByRole("button", { name: "Kayıttan çıkar" }).waitFor({ timeout: 15000 });
}
async function clickSync(page) {
  await goto(page, "#/me");
  const btn = page.getByRole("button", { name: "Şimdi eşitle" });
  await btn.waitFor();
  await btn.click();
  await page.waitForTimeout(400);
  await until(page, () => !/Eşitleniyor/.test(document.querySelector(".sync-status")?.textContent || ""), null, "sync to finish");
}
const statusText = (page) => page.locator(".sync-status").innerText();
const learned = async (page) => {
  await goto(page, "#/me");
  return (await page.locator(".stat-strip div", { hasText: "Yakılan" }).locator("dd").innerText()).trim();
};

const card = (i) => ({ due: Date.now() + 86400e3 * (i + 1), s: 2, d: 5, el: 1, sd: 0, ls: 0, reps: 1, lapses: 0, st: 2, last: Date.now(), seen: Date.now() - 1000 });

let browser;
let failed = false;
try {
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", NO_COLOR: "1" };
  if (LIVE) {
    console.log(`Testing deployed site ${APP} against ${API}...`);
  } else {
    console.log("Starting worker and app...");
    const schema = spawnSync("npm run db:local", { cwd: worker, env, shell: true, encoding: "utf8" });
    if (schema.status !== 0) throw new Error(`db:local failed:\n${schema.stdout}\n${schema.stderr}`);
    const w = spawn(process.execPath, [join(worker, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--local", "--port", "8787"], { cwd: worker, env, stdio: "ignore" });
    children.push(w);
    const v = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--port", "5199", "--strictPort"], { cwd: root, env: { ...process.env, VITE_SYNC_URL: API }, stdio: "ignore" });
    children.push(v);
    await Promise.all([waitFor(`${API}/v1/health`, "worker", w), waitFor(APP, "vite", v)]);
  }

  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctxA = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: "tr-TR", permissions: ["clipboard-read", "clipboard-write"] });
  const ctxB = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: "tr-TR" });
  // Device A starts onboarded with three learned words; device B is brand new (onboarding must not block joining).
  await ctxA.addInitScript(
    ([ds, cards]) => {
      if (localStorage.getItem("word-atlas:settings")) return;
      localStorage.setItem("word-atlas:settings", JSON.stringify({ onboarded: true, splash: false, sfx: false, autoplay: false, ambience: "off" }));
      localStorage.setItem(`word-atlas:v2:${ds}`, JSON.stringify({ version: 2, datasetId: ds, cards, bookmarks: [], bookmarkTimes: {}, days: {}, otherDays: {}, typing: [], session: null, mistakes: [] }));
    },
    [DATASET, Object.fromEntries([0, 1, 2].map((i) => [W[i].id, card(i)]))],
  );
  await ctxB.addInitScript(() => {
    // Keep the splash and sound out of the way without touching onboarding.
    if (!localStorage.getItem("word-atlas:settings")) localStorage.setItem("word-atlas:settings", JSON.stringify({ splash: false, sfx: false, autoplay: false, ambience: "off" }));
  });
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  for (const [n, p] of [["A", A], ["B", B]]) p.on("pageerror", (e) => console.log(`  [${n}] pageerror: ${e.message}`));
  A.on("dialog", (d) => d.accept());
  B.on("dialog", (d) => d.accept());

  let code = "";

  await step("1. A: enable sync from Profile and read the code", async () => {
    await A.goto(`${APP}/#/me`);
    await A.getByRole("heading", { name: "Cihazlarımı eşitle" }).waitFor({ timeout: 30000 });
    await A.getByRole("button", { name: "Eşitlemeyi aç" }).click();
    const el = A.getByTestId("sync-code");
    await el.waitFor({ timeout: 15000 });
    code = (await el.innerText()).trim();
    ok(/^[a-z]+(-[a-z]+){3}-\d{4}$/.test(code), `unexpected code "${code}"`);
    await A.locator(".qr-tile svg").waitFor();
    await A.waitForTimeout(800);
    await A.screenshot({ path: join(SHOTS, "qr-sheet-dark.png") });
    await A.keyboard.press("Escape");
    await A.getByText("Eşitleme açık").first().waitFor();
    await A.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await A.getByRole("button", { name: "Başka cihaz ekle" }).click();
    await A.locator(".qr-tile svg").waitFor();
    await A.waitForTimeout(800);
    await A.screenshot({ path: join(SHOTS, "qr-sheet-light.png") });
    await A.keyboard.press("Escape");
    await A.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  });

  await step("2. A: bookmark a word, press Şimdi eşitle", async () => {
    ok((await learned(A)) === "3", "A should show 3 learned words");
    await bookmarkWord(A, W[3]);
    await bookmarks(A, [W[3].id], "A bookmark saved");
    await clickSync(A);
    ok(/Son eşitleme: az önce/.test(await statusText(A)), `A status: ${await statusText(A)}`);
  });

  await step("3. B: open join link, Bağla, sees A's progress and bookmark", async () => {
    await B.goto(`${APP}/#/sync?c=${code}`);
    await B.getByText("Bu cihazı eşitlemeye bağla?").waitFor({ timeout: 30000 });
    await B.screenshot({ path: join(SHOTS, "join-screen.png") });
    await B.getByRole("button", { name: "Bağla", exact: true }).click();
    await B.getByText("Bu cihaz eşitlendi ✓").first().waitFor({ timeout: 20000 });
    await B.waitForFunction(() => !location.hash.includes("c="), null, { timeout: 5000 });
    await B.waitForFunction(() => location.hash === "#/" || location.hash === "", null, { timeout: 8000 });
    ok(!(await B.locator(".onboard").count()), "onboarding must be skipped after joining");
    ok((await learned(B)) === "3", "B should show 3 learned words");
    await bookmarks(B, [W[3].id], "B has A's bookmark in storage");
    await isBookmarkedInUI(B, W[3]);
    ok((await readLS(B, "word-atlas:settings")).onboarded === true, "settings adopted");
  });

  await step("4. B bookmarks another word, syncs; A syncs and receives it", async () => {
    await bookmarkWord(B, W[4]);
    await bookmarks(B, [W[4].id], "B bookmark saved");
    await clickSync(B);
    await clickSync(A);
    await bookmarks(A, [W[3].id, W[4].id], "A receives B's bookmark");
    await isBookmarkedInUI(A, W[4]);
  });

  await step("5. Concurrent edits on both devices merge after syncing", async () => {
    await bookmarkWord(A, W[5]);
    await bookmarkWord(B, W[6]);
    await bookmarks(A, [W[5].id], "A local");
    await bookmarks(B, [W[6].id], "B local");
    await clickSync(A);
    await clickSync(B);
    await clickSync(A);
    const all = [W[3], W[4], W[5], W[6]].map((x) => x.id);
    await bookmarks(A, all, "A has all bookmarks");
    await bookmarks(B, all, "B has all bookmarks");
  });

  await step("6. A deletes server data; B gets 'artık geçerli değil' and keeps progress", async () => {
    await goto(A, "#/me");
    await A.getByRole("button", { name: "Eşitleme verisini sunucudan sil" }).click();
    await A.getByRole("button", { name: "Eşitlemeyi aç" }).waitFor({ timeout: 15000 });
    await clickSync(B).catch(() => null);
    await until(B, () => /artık geçerli değil/.test(document.querySelector(".sync-status")?.textContent || ""), null, "B removed error");
    await B.screenshot({ path: join(SHOTS, "removed-error.png") });
    const p = await progress(B);
    ok(Object.keys(p.cards).length === 3 && p.bookmarks.length >= 4, "B must keep its progress");
    ok((await learned(B)) === "3", "B still shows 3 learned words");
  });
} catch (e) {
  failed = true;
  if (!results.some((r) => !r[1])) console.log("Setup error:", e);
} finally {
  await browser?.close().catch(() => null);
  killAll();
}

console.log(`\n${results.filter((r) => r[1]).length}/${results.length} steps passed${failed ? " (stopped at first failure)" : ""}. Screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
