import { build } from "esbuild";
export async function domainRuntime() {
  const result = await build({
    stdin: {
      contents:
        "export * from './src/domain/model'; export * from './src/domain/rules';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  return import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].text).toString("base64")
  );
}
