import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { blank } from "../src/domain/model";
import {
  parseDelimited,
  previewTeachers,
  suggestColumns,
} from "../src/domain/teacherImport";
import { readGoogleSheet, readTeacherFile } from "../electron/teacherFile";
import { columnLetter, detectHeader } from "../src/domain/teacherImport";
describe("교사 명단 가져오기", () => {
  it("BOM, 쉼표, 따옴표, 셀 내부 줄바꿈을 보존한다", () => {
    expect(
      parseDelimited(
        '\uFEFF교사명,담당과목,메모\r\n김민서,"국어,문학","첫 줄\n둘째 줄"',
      ),
    ).toEqual([
      ["교사명", "담당과목", "메모"],
      ["김민서", "국어,문학", "첫 줄\n둘째 줄"],
    ]);
    expect(() => parseDelimited('이름,과목\n"김민서,국어')).toThrow();
  });
  it("구글시트 복사 표의 열 순서를 인식하고 학급 ID로 연결한다", () => {
    const d = blank();
    d.rooms = [{ id: "r1", name: "1-1", grade: 1, kind: "classroom" }];
    const rows = parseDelimited(
      "과목\t성명\t담임\t역할\n국어/문학\t김민서\t1학년 1반\t필수배치",
    );
    const [r] = previewTeachers(rows, 0, suggestColumns(rows[0]), d);
    expect(r.errors).toEqual([]);
    expect(r.teacher).toMatchObject({
      name: "김민서",
      subjects: ["국어", "문학"],
      homeroom: "r1",
      role: "designated",
    });
  });
  it("없는 학급과 모르는 역할도 불러오고 수정 필요로 남긴다", () => {
    const rows = [
      ["교사명", "담임", "역할"],
      ["김민서", "9-9", "알수없음"],
    ];
    const [r] = previewTeachers(rows, 0, suggestColumns(rows[0]), blank());
    expect(r.errors).toEqual([]);
    expect(r.teacher).toMatchObject({ homeroom: null, role: "normal" });
    expect(r.teacher.review).toHaveLength(2);
  });
  it("동명이인은 별도 ID이며 경고한다", () => {
    const rows = [
      ["교사명", "담당과목"],
      ["김민서", "국어"],
      ["김민서", "영어"],
    ];
    const found = previewTeachers(rows, 0, suggestColumns(rows[0]), blank());
    expect(found[0].teacher.id).not.toBe(found[1].teacher.id);
    expect(found.every((r) => r.warnings.length)).toBe(true);
  });
  it("여러 시트가 있는 실제 xlsx와 CSV를 읽고 손상 파일을 거부한다", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proctor-teachers-"));
    const file = path.join(dir, "명단.xlsx");
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("안내").addRow(["안내"]);
    const sh = wb.addWorksheet("교사");
    sh.addRows([
      ["교사명", "담당과목"],
      ["김민서", "국어"],
      ["이서준", "수학"],
    ]);
    await wb.xlsx.writeFile(file);
    const sheets = await readTeacherFile(file);
    expect(sheets.map((s) => s.name)).toEqual(["안내", "교사"]);
    expect(sheets[1].rows[2]).toEqual(["이서준", "수학"]);
    const csv = path.join(dir, "명단.csv");
    await writeFile(csv, "교사명,담당과목\n김민서,국어");
    expect((await readTeacherFile(csv))[0].rows).toHaveLength(2);
    const bad = path.join(dir, "손상.xlsx");
    await writeFile(bad, "broken");
    await expect(readTeacherFile(bad)).rejects.toThrow();
  });
  it("제목 행을 자동으로 찾고 없으면 모든 행을 명단으로 본다", () => {
    expect(detectHeader([["2학기 명단"], ["성명", "과목"], ["김민서", "국어"]])).toBe(1);
    expect(detectHeader([["김민서", "국어"]])).toBe(-1);
    expect([0, 1, 25, 26].map(columnLetter)).toEqual(["A", "B", "Z", "AA"]);
  });
  it("Google Sheets 링크가 아니면 요청하지 않고 안내한다", async () => {
    await expect(readGoogleSheet("https://example.com/x")).rejects.toThrow(
      "docs.google.com",
    );
    await expect(readGoogleSheet("구글시트")).rejects.toThrow("주소");
  });
});
