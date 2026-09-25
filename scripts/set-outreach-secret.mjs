// Copies OUTREACH_AUTOMATION_SECRET from .env.local to Vercel Production as a
// sensitive variable, then (with --deploy) redeploys so the routes pick it up.
//
//   node scripts/set-outreach-secret.mjs [--deploy]
//
// The value goes to the Vercel CLI over stdin, so it never appears in the
// process list or in this script's output.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const NAME = "OUTREACH_AUTOMATION_SECRET";

const line = readFileSync(".env.local", "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith(`${NAME}=`));
const value = line?.slice(NAME.length + 1).trim();
if (!value) {
  console.error(`${NAME} is missing from .env.local`);
  process.exit(1);
}

function vercel(args, input) {
  const result = spawnSync("vercel", args, { input, stdio: [input ? "pipe" : "ignore", "inherit", "inherit"], shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

vercel(["env", "add", NAME, "production", "--sensitive", "--force"], value);
console.log(`${NAME} set in Vercel Production.`);

if (process.argv.includes("--deploy")) {
  vercel(["deploy", "--prod"]);
} else {
  console.log("Redeploy for it to take effect: vercel deploy --prod (or push to main).");
}
