import { it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../electron/storage";
import { sample } from "../src/domain/model";

it("JSON 왕복, 재시작 복원, 손상 파일 백업 복구", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "exam-store-"));
  try {
    const store = new Store(dir),
      d = sample();
    await store.save(d);
    expect(
      JSON.parse(await readFile(path.join(dir, d.id + ".json"), "utf8")),
    ).toEqual(d);
    expect((await new Store(dir).current())?.document).toEqual(d);
    const changed = { ...d, title: "수정한 고사" };
    await store.save(changed);
    await writeFile(path.join(dir, d.id + ".json"), "{ broken");
    const recovered = await store.load(d.id);
    expect(recovered.recovered).toBe(true);
    expect(recovered.document.title).toBe(d.title);
    expect((await store.list())[0].recovered).toBe(true);
    await store.save({ ...d, title: "복구 저장" });
    expect((await store.load(d.id)).document.title).toBe("복구 저장");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("잘못된 입력은 정상 파일을 덮어쓰지 않고 동시 저장을 순서대로 처리", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "exam-store-"));
  try {
    const store = new Store(dir),
      d = sample();
    await store.save(d);
    await expect(store.save({ ...d, version: 99 })).rejects.toThrow();
    expect((await store.load(d.id)).document).toEqual(d);
    await Promise.all([
      store.save({ ...d, title: "first" }),
      store.save({ ...d, title: "second" }),
    ]);
    expect((await store.load(d.id)).document.title).toBe("second");
    await expect(store.load("../outside")).rejects.toThrow("ID");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
