// The former counterexample search is now a deterministic exhaustive regression suite.
import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "tests/solver.test.ts"],
  { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
