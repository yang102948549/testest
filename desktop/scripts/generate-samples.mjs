import { mkdir, writeFile } from "node:fs/promises";
import { domainRuntime } from "./domain-runtime.mjs";
const { sample } = await domainRuntime();
await mkdir("samples", { recursive: true });
await writeFile("samples/example-exam.json", JSON.stringify(sample(), null, 2));
await writeFile(
  "samples/large-exam.json",
  JSON.stringify(sample(true), null, 2),
);
console.log("예시 고사 2개를 samples/에 저장했습니다.");
