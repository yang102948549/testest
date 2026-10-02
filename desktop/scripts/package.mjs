import { spawn } from "node:child_process";
import { access, cp, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import "./build-license-verifier.mjs";
import "./third-party-notices.mjs";

// Keep downloaded build tools local. Antivirus/OneDrive may briefly lock an
// extracted NSIS directory and reject electron-builder's immediate rename.
const cache = path.resolve(
  process.env.ELECTRON_BUILDER_CACHE || ".builder-cache",
);
const env = { ...process.env, ELECTRON_BUILDER_CACHE: cache };
const tools = [
  {
    release: "nsis-3.0.4.1",
    target: "nsis-toolset",
    variable: "ELECTRON_BUILDER_NSIS_DIR",
    required: "Bin/makensis.exe",
    sha: "9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa",
  },
  {
    release: "nsis-resources-3.4.1",
    target: "nsis-plugins",
    variable: "ELECTRON_BUILDER_NSIS_RESOURCES_DIR",
    required: "plugins/x86-unicode",
    sha: "593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103",
  },
];
const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};
async function recoverTools() {
  let recovered = false;
  for (const tool of tools) {
    if (env[tool.variable]) continue;
    const destination = path.join(cache, tool.target);
    if (await exists(path.join(destination, tool.required))) {
      env[tool.variable] = destination;
      recovered = true;
      continue;
    }
    const root = path.join(cache, tool.release);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const stage = entries.find(
      (e) =>
        e.isDirectory() &&
        e.name.startsWith(tool.release + "-") &&
        e.name.endsWith(".tmp"),
    );
    if (!stage) continue;
    const archive = await readFile(path.join(root, tool.release + ".7z"));
    if (createHash("sha256").update(archive).digest("hex") !== tool.sha)
      throw new Error("NSIS 다운로드 체크섬이 일치하지 않습니다.");
    const source = path.join(root, stage.name);
    if (!(await exists(path.join(source, tool.required)))) continue;
    await cp(source, destination, { recursive: true });
    env[tool.variable] = destination;
    recovered = true;
  }
  return recovered;
}
await recoverTools();
for (let attempt = 0; attempt < 3; attempt++) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["node_modules/electron-builder/cli.js", "--win", "--x64", "--config.electronDist=node_modules/electron/dist", ...process.argv.slice(2)],
      { env, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code === 0) process.exit(0);
  if (attempt === 2 || !(await recoverTools()))
    process.exit(typeof code === "number" ? code : 1);
  console.log("검증된 NSIS 리소스 경로로 패키징을 다시 시도합니다.");
}
