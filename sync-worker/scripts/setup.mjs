// One-time production setup. Run after `npx wrangler login`. Safe to run again.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "kelime-atlasi-sync";
const toml = join(root, "wrangler.toml");

function wr(args) {
  const r = spawnSync("npx", ["wrangler", ...args], { cwd: root, encoding: "utf8", shell: true });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}
function fail(msg, detail) {
  console.error(`\nERROR: ${msg}`);
  if (detail) console.error(detail.trim());
  console.error("\nIf you are not logged in, run: npx wrangler login");
  process.exit(1);
}
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

console.log(`Step 1/3: creating D1 database "${NAME}" ...`);
let id;
const created = wr(["d1", "create", NAME]);
if (created.ok) {
  id = created.out.match(new RegExp(`database_id\\s*=\\s*"(${UUID.source})"`, "i"))?.[1] ?? created.out.match(UUID)?.[0];
} else {
  console.log("Create failed (it may already exist); looking it up ...");
  const list = wr(["d1", "list", "--json"]);
  if (!list.ok) fail("Could not create or list D1 databases.", created.out + "\n" + list.out);
  try {
    const json = list.out.slice(list.out.indexOf("["), list.out.lastIndexOf("]") + 1);
    id = JSON.parse(json).find((d) => d.name === NAME)?.uuid;
  } catch {
    fail("Could not parse `wrangler d1 list --json` output.", list.out);
  }
  if (!id) fail(`Database "${NAME}" could not be created and was not found.`, created.out);
}
if (!id) fail("Could not find the database_id in wrangler output.", created.out);
console.log(`Database id: ${id}`);

console.log("Step 2/3: writing database_id into wrangler.toml ...");
const src = readFileSync(toml, "utf8");
const next = src.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${id}"`);
if (next === src && !src.includes(id)) fail("Could not find database_id in wrangler.toml.");
writeFileSync(toml, next);

console.log("Step 3/3: applying schema to the remote database ...");
const ex = wr(["d1", "execute", NAME, "--remote", "--file", "schema.sql"]);
if (!ex.ok) fail("Applying schema.sql failed.", ex.out);

console.log("\nSetup complete. Now run: npm run deploy");
console.log("Then copy the https://kelime-atlasi-sync.<account>.workers.dev URL into the repository variable SYNC_URL.");
