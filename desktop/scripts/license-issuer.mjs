import { generateKeyPairSync, createPublicKey, sign, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

const command = process.argv[2];
const option = name => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const secretDir = path.resolve(".license-secrets");
const privateFile = path.join(secretDir, "issuer-private.pem");
const publicFile = path.resolve("build/license-public-key.json");
const exists = async file => { try { await access(file); return true; } catch { return false; } };

if (command === "init") {
  if (await exists(privateFile) || await exists(publicFile))
    throw new Error("발급 키가 이미 있습니다. 기존 키를 덮어쓰지 않습니다.");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  await mkdir(secretDir, { recursive: true });
  await mkdir(path.dirname(publicFile), { recursive: true });
  await writeFile(privateFile, pair.privateKey, { flag: "wx", mode: 0o600 });
  await writeFile(publicFile, JSON.stringify({ algorithm: "RSA-SHA256", pem: pair.publicKey }, null, 2) + "\n", { flag: "wx" });
  console.log("판매자 발급 키를 생성했습니다. .license-secrets 폴더는 별도로 백업하고 고객에게 배포하지 마세요.");
} else if (command === "issue") {
  const customer = option("--customer")?.trim();
  const output = option("--out");
  if (!customer || customer.length > 60 || !output)
    throw new Error('사용법: npm run license:issue -- --customer "구매자 또는 학교명" --out "발급파일.txt" (이름 최대 60자)');
  const privateKey = await readFile(privateFile, "utf8");
  const published = JSON.parse(await readFile(publicFile, "utf8"));
  if (createPublicKey(privateKey).export({ type: "spki", format: "pem" }) !== published.pem)
    throw new Error("발급용 개인키와 프로그램 공개키가 일치하지 않습니다.");
  const payload = { version: 1, product: "exam-proctor-desktop", id: randomUUID(), customer, issuedAt: new Date().toISOString() };
  const body = `YY1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const token = `${body}.${sign("RSA-SHA256", Buffer.from(body, "ascii"), privateKey).toString("base64url")}`;
  // Keep the installer edit buffer comfortably below NSIS's default 1024 chars.
  if (token.length >= 1000) throw new Error("인증키가 너무 깁니다. 구매자 이름을 줄여 주세요.");
  const file = path.resolve(output);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, token + "\n", { flag: "wx", mode: 0o600 });
  await writeFile(path.join(secretDir, `${payload.id}.json`), JSON.stringify({ ...payload, output: file }, null, 2), { flag: "wx", mode: 0o600 });
  console.log(`인증키 발급 완료: ${file}\n개인키는 이 파일에 포함되지 않습니다.`);
} else {
  throw new Error("지원 명령: init, issue --customer 이름 --out 파일경로");
}
