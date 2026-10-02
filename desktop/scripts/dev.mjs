import { createServer } from "vite";
import { context } from "esbuild";
import { spawn } from "node:child_process";
import electron from "electron";
const server = await createServer();
await server.listen();
server.printUrls();
const url = server.resolvedUrls.local[0];
console.log(`[dev] Vite dev server ready at ${url}`);
let child = null,
  restarting = false;
const launch = () => {
  console.log(`[dev] Launching Electron with VITE_DEV_SERVER_URL=${url}...`);
  child = spawn(electron, ["."], {
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });
  child.on("error", (err) => console.error("[dev] Failed to spawn electron:", err));
  child.on("exit", async (code) => {
    console.log(`[dev] Electron exited with code ${code}`);
    if (restarting) return;
    await ctx.dispose();
    await server.close();
    process.exit(code ?? 0);
  });
};
// Renderer code hot-reloads through Vite; main/preload only load at startup,
// so rebuild them on change and restart Electron.
const ctx = await context({
  entryPoints: ["electron/main.ts", "electron/preload.ts"],
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  target: "node22",
  plugins: [
    {
      name: "restart-electron",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) {
            console.error("[dev] esbuild build failed with errors:", result.errors);
            return;
          }
          if (!child) return launch();
          console.log("[dev] electron/ 변경 감지 → 앱을 다시 시작합니다");
          restarting = true;
          child.once("exit", () => {
            restarting = false;
            launch();
          });
          child.kill();
        });
      },
    },
  ],
});
await ctx.watch();
