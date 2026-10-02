import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LicenseStore, verifyLicense } from "../electron/license";

const pair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const payload = {
  version: 1,
  product: "exam-proctor-desktop",
  id: randomUUID(),
  customer: "테스트 학교",
  issuedAt: new Date().toISOString(),
};
const issue = (p: unknown, privateKey = pair.privateKey) => {
  const body = "YY1." + Buffer.from(JSON.stringify(p)).toString("base64url");
  return (
    body +
    "." +
    sign("RSA-SHA256", Buffer.from(body, "ascii"), privateKey).toString(
      "base64url",
    )
  );
};
describe("signed offline CD keys", () => {
  it("accepts a signed key and pasted whitespace", () => {
    const token = issue(payload);
    expect(verifyLicense(token, pair.publicKey)).toEqual(payload);
    expect(
      verifyLicense(
        " \n" + token.replaceAll(".", ".\n") + "\r\n",
        pair.publicKey,
      ),
    ).toEqual(payload);
  });
  it("rejects tampered customer and signature, wrong product and malformed input", () => {
    const token = issue(payload),
      parts = token.split(".");
    parts[1] = Buffer.from(
      JSON.stringify({ ...payload, customer: "Modified" }),
    ).toString("base64url");
    for (const bad of [
      parts.join("."),
      token.slice(0, -3) + "AAA",
      issue({ ...payload, product: "other" }),
      issue({ ...payload, version: 2 }),
      issue({ ...payload, extra: true }),
      "",
      "ABCDE-12345",
      "x".repeat(5000),
      null,
    ])
      expect(() => verifyLicense(bad, pair.publicKey)).toThrow();
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() =>
      verifyLicense(
        token,
        other.publicKey.export({ type: "spki", format: "pem" }) as string,
      ),
    ).toThrow();
  });
  it("unlicensed storage stays locked, activation persists, bad keys cannot overwrite it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proctor-license-"));
    const file = path.join(dir, "user.key"),
      installed = path.join(dir, "installed.key");
    const store = new LicenseStore(file, installed, true, pair.publicKey);
    expect((await store.status()).active).toBe(false);
    await store.activate(issue(payload));
    expect(await store.status()).toMatchObject({
      active: true,
      customer: payload.customer,
    });
    await expect(store.activate("bad-key")).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(issue(payload));
    expect(
      (await new LicenseStore(file, installed, true, pair.publicKey).status())
        .active,
    ).toBe(true);
    await writeFile(file, "tampered");
    expect((await store.status()).active).toBe(false);
    await writeFile(installed, issue(payload));
    expect((await store.status()).active).toBe(true);
    await writeFile(installed, "tampered");
    expect((await store.status()).active).toBe(false);
  });
});
