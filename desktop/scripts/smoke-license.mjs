import { _electron as electron } from "playwright-core";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const root = process.cwd();
const profile = path.join(root, "test-artifacts", `license-profile-${Date.now()}`);
await mkdir(profile, { recursive: true });
const token = await readFile(path.join(root, "test-artifacts/license-test.key"), "utf8");
const bad = path.join(profile, "bad.key");
await writeFile(bad, "YY1.invalid.invalid");
const run = (exe, args) => new Promise((resolve, reject) => {
  const child = spawn(exe, args, { windowsHide: true, stdio: "ignore" });
  child.on("error", reject); child.on("exit", resolve);
});
const verifier = path.join(root, "build/license-verifier.exe");
assert.equal(await run(verifier, [path.join(root, "test-artifacts/license-test.key")]), 0);
assert.equal(await run(verifier, [bad]), 2);
assert.equal(await run(verifier, [path.join(profile, "missing.key")]), 2);
if (process.argv.includes("--installer")) {
  const destination = path.join(profile, "rejected-install");
  const installer = path.join(root, "release/ExamProctor-1.2.0-x64-Setup.exe");
  assert.equal(await run(installer, ["/S", "/currentuser", `/LICENSEFILE=${bad}`, `/D=${destination}`]), 2);
  assert.equal(await access(path.join(destination, "ExamProctor.exe")).then(() => true, () => false), false);
  console.log("PASS: silent installer rejects invalid CD key before installing app");
}
const unpacked = path.join(root, "release/win-unpacked");
assert.equal(await access(path.join(unpacked, "license.key")).then(() => true, () => false), false);
const require = createRequire(import.meta.url);
const files = require("@electron/asar").listPackage(path.join(unpacked, "resources/app.asar"));
assert(!files.some(f => /issuer-private|license-test|license-secrets|license-issuer/.test(f)));
let app;
const launch = async () => {
  app = await electron.launch({ executablePath: path.join(unpacked, "ExamProctor.exe"),
    env: { ...process.env, PROCTOR_TEST_DATA: profile, PROCTOR_TEST_HIDDEN: "1" }, timeout: 40000 });
  return app.firstWindow();
};
const stop = async () => { await app.evaluate(({ app }) => app.exit()); app = undefined; };
try {
  let page = await launch();
  await page.locator("#license-key").waitFor();
  assert.equal(await page.evaluate(async () => (await window.desktop.licenseStatus()).active), false);
  assert(await page.evaluate(async () => { try { await window.desktop.current(); return false; } catch { return true; } }));
  await page.locator("#license-key").fill("invalid-key");
  await page.getByRole("button", { name: "인증하고 시작" }).click();
  await page.getByRole("alert").waitFor();
  await page.locator("#license-key").fill(token.trim());
  await page.getByRole("button", { name: "인증하고 시작" }).click();
  await page.locator("nav").waitFor();
  assert.equal(await page.evaluate(async () => (await window.desktop.licenseStatus()).active), true);
  await page.screenshot({ path: path.join(root, "test-artifacts/licensed-app.png") });
  await stop();
  page = await launch();
  await page.locator("nav").waitFor();
  await stop();
  await writeFile(path.join(profile, "license.key"), "tampered");
  page = await launch();
  await page.locator("#license-key").waitFor();
  await stop();
  console.log("PASS: installer verifier, no bundled secrets/license, packaged IPC lock, activation, restart, tamper rejection");
} finally { if (app) await stop(); }
