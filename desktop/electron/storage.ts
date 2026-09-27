import {
  mkdir,
  readFile,
  writeFile,
  rename,
  copyFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { documentSchema, ExamDocument } from "../src/domain/model";

/**
 * Windows refuses to replace a file another process has open (a reader,
 * OneDrive sync, antivirus): EPERM/EBUSY/EACCES. Those locks are brief, so retry.
 */
async function replaceFile(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 8 || !["EPERM", "EBUSY", "EACCES"].includes(code ?? ""))
        throw e;
      await new Promise((r) => setTimeout(r, 25 * 2 ** Math.min(attempt, 5)));
    }
  }
}

export class Store {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  private file(id: string) {
    if (!/^[a-zA-Z0-9-]{1,120}$/.test(id)) throw new Error("잘못된 고사 ID");
    return path.join(this.directory, `${id}.json`);
  }
  async save(input: unknown) {
    const d = documentSchema.parse(input),
      file = this.file(d.id);
    const job = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      try {
        documentSchema.parse(JSON.parse(await readFile(file, "utf8")));
        await copyFile(file, file + ".bak");
      } catch (e) {
        if (
          (e as NodeJS.ErrnoException).code !== "ENOENT" &&
          !(e instanceof SyntaxError) &&
          (e as Error).name !== "ZodError"
        )
          throw e;
      }
      await writeFile(file + ".tmp", JSON.stringify(d, null, 2), "utf8");
      await replaceFile(file + ".tmp", file);
      await writeFile(
        path.join(this.directory, "current.txt.tmp"),
        d.id,
        "utf8",
      );
      await replaceFile(
        path.join(this.directory, "current.txt.tmp"),
        path.join(this.directory, "current.txt"),
      );
      return d.updatedAt;
    });
    this.queue = job.catch(() => {});
    return job;
  }
  async load(
    id: string,
  ): Promise<{ document: ExamDocument; recovered: boolean }> {
    await this.queue;
    const file = this.file(id);
    try {
      return {
        document: documentSchema.parse(
          JSON.parse(await readFile(file, "utf8")),
        ),
        recovered: false,
      };
    } catch {
      try {
        return {
          document: documentSchema.parse(
            JSON.parse(await readFile(file + ".bak", "utf8")),
          ),
          recovered: true,
        };
      } catch {
        throw new Error(
          "고사 파일과 백업을 읽을 수 없습니다. JSON 백업을 가져와 주세요.",
        );
      }
    }
  }
  async current() {
    // Never read current.txt while a save is replacing it.
    await this.queue;
    let id: string;
    try {
      id = (
        await readFile(path.join(this.directory, "current.txt"), "utf8")
      ).trim();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    return this.load(id);
  }
  async list() {
    await this.queue;
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const entries = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          try {
            const { document: d, recovered } = await this.load(f.slice(0, -5));
            return {
              id: d.id,
              title: d.title,
              updatedAt: d.updatedAt,
              teachers: d.teachers.length,
              recovered,
              error: false,
            };
          } catch {
            return {
              id: f.slice(0, -5),
              title: "손상된 고사 파일",
              updatedAt: "",
              teachers: 0,
              recovered: false,
              error: true,
            };
          }
        }),
    );
    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
