import { createServer } from "vite";
import { context } from "esbuild";
import { spawn } from "node:child_process";
import electron from "electron";
const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
let child = null,
  restarting = false;
const launch = () => {
  child = spawn(electron, ["."], {
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });
  child.on("exit", async (code) => {
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
          if (result.errors.length) return;
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
