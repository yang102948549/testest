import { verify, createPublicKey } from "node:crypto";
import { readFile, mkdir, writeFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import publicKey from "../build/license-public-key.json";

export const LICENSE_PRODUCT = "exam-proctor-desktop";
export type LicensePayload = {
  version: 1;
  product: typeof LICENSE_PRODUCT;
  id: string;
  customer: string;
  issuedAt: string;
};
export type LicenseStatus = {
  active: boolean;
  development?: boolean;
  customer?: string;
  id?: string;
  message?: string;
};

/** No private/signing material is shipped with the application. */
export function verifyLicense(
  input: unknown,
  pem = publicKey.pem,
): LicensePayload {
  if (typeof input !== "string" || input.length > 4096)
    throw new Error("인증키를 확인해 주세요.");
  const token = input.replace(/\s/g, "");
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== "YY1" ||
    !/^[A-Za-z0-9_-]+$/.test(parts[1]) ||
    !/^[A-Za-z0-9_-]+$/.test(parts[2])
  )
    throw new Error(
      "인증키 형식이 올바르지 않습니다. 전달받은 키 전체를 붙여넣어 주세요.",
    );
  const data = Buffer.from(parts[1], "base64url"),
    signature = Buffer.from(parts[2], "base64url");
  if (
    data.toString("base64url") !== parts[1] ||
    signature.toString("base64url") !== parts[2] ||
    !verify(
      "RSA-SHA256",
      Buffer.from(`YY1.${parts[1]}`, "ascii"),
      createPublicKey(pem),
      signature,
    )
  )
    throw new Error("유효하지 않은 인증키입니다. 발급받은 키를 확인해 주세요.");
  let p: LicensePayload;
  try {
    p = JSON.parse(data.toString("utf8"));
  } catch {
    throw new Error("인증키 내용을 읽을 수 없습니다.");
  }
  if (
    !p ||
    p.version !== 1 ||
    p.product !== LICENSE_PRODUCT ||
    typeof p.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(p.id) ||
    typeof p.customer !== "string" ||
    !p.customer.trim() ||
    p.customer.length > 60 ||
    typeof p.issuedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.issuedAt) ||
    !Number.isFinite(Date.parse(p.issuedAt)) ||
    Object.keys(p).sort().join(",") !== "customer,id,issuedAt,product,version"
  )
    throw new Error("이 프로그램용 인증키가 아닙니다.");
  return p;
}

export class LicenseStore {
  constructor(
    private userFile: string,
    private installedFile: string,
    private required = true,
    private pem = publicKey.pem,
  ) {}
  async status(): Promise<LicenseStatus> {
    if (!this.required) return { active: true, development: true };
    for (const file of [this.userFile, this.installedFile]) {
      try {
        if ((await stat(file)).size > 4096) continue;
        const p = verifyLicense(await readFile(file, "utf8"), this.pem);
        return { active: true, customer: p.customer, id: p.id };
      } catch {
        /* Missing/invalid files never activate the app. */
      }
    }
    return {
      active: false,
      message: "설치 시 입력한 인증키가 없거나 유효하지 않습니다.",
    };
  }
  async activate(input: unknown): Promise<LicenseStatus> {
    const p = verifyLicense(input, this.pem);
    await mkdir(path.dirname(this.userFile), { recursive: true });
    const token = (input as string).replace(/\s/g, "");
    await writeFile(this.userFile + ".tmp", token, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(this.userFile + ".tmp", this.userFile);
    return { active: true, customer: p.customer, id: p.id };
  }
}
