import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

// Use the lockfile's production closure, including nested dependency versions.
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const chunks = ["Oni 감독 — 제작자 Oniabey", "Third-party software notices", "아래 구성요소의 권리와 라이선스는 각 저작권자에게 있습니다.\n"];
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location || entry.dev || entry.optional) continue;
  const dir = path.resolve(location);
  let pkg, files;
  try { pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")); files = await readdir(dir); } catch { continue; }
  chunks.push(`\n===== ${pkg.name} ${pkg.version} =====\nLicense: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license ?? entry.license ?? "See package source")}\nSource: ${typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? ""}`);
  for (const file of files.filter(f => /^(licen[cs]e|copying|notice|ofl)(\.|-|$)/i.test(f))) {
    try { chunks.push(`\n${file}\n${await readFile(path.join(dir, file), "utf8")}`); } catch { /* directories */ }
  }
}
await writeFile("build/THIRD-PARTY-NOTICES.txt", chunks.join("\n"), "utf8");
console.log("배포용 외부 구성요소 라이선스 고지 생성 완료");
