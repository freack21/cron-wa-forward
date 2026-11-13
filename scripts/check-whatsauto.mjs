// Compare the installed / declared whatsauto.js with the latest npm release.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const declared = JSON.parse(readFileSync("package.json", "utf-8")).dependencies["whatsauto.js"];
let installed = "missing";
try {
  installed = JSON.parse(readFileSync("node_modules/whatsauto.js/package.json", "utf-8")).version;
} catch {}
const latest = execSync("npm view whatsauto.js version", { encoding: "utf-8" }).trim();
if (installed === latest && declared.replace(/^[\^~]/, "") === latest) {
  console.log(`[whatsauto.js] up to date: ${latest}.`);
} else {
  console.log(`[whatsauto.js] latest ${latest}, installed ${installed}, declared ${declared}.`);
  console.log("Run: npm install whatsauto.js@latest");
  process.exitCode = 1;
}
