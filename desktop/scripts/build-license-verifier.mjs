import { createPublicKey } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const { pem } = JSON.parse(await readFile("build/license-public-key.json", "utf8"));
const jwk = createPublicKey(pem).export({ format: "jwk" });
const source = (await readFile("build/license-verifier.cs", "utf8"))
  .replace("__PUBLIC_MODULUS__", Buffer.from(jwk.n, "base64url").toString("base64"))
  .replace("__PUBLIC_EXPONENT__", Buffer.from(jwk.e, "base64url").toString("base64"));
const generated = path.resolve("build/license-verifier.generated.cs");
await writeFile(generated, source, "utf8");
const compiler = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
await access(compiler);
const result = spawnSync(compiler, ["/nologo", "/target:winexe", "/optimize+", "/reference:System.Web.Extensions.dll",
  `/out:${path.resolve("build/license-verifier.exe")}`, generated], { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("설치 인증키 검증 도구 빌드 실패");
console.log("설치 인증키 검증 도구 빌드 완료 (공개키만 포함)");
