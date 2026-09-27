import { describe, expect, it } from "vitest";
import { sample } from "../src/domain/model";
import { solve } from "../src/domain/engine";
import { buildWorkbook } from "../src/domain/exportBook";
import { writeWorkbook } from "../electron/exportXlsx";
import ExcelJS from "exceljs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("엑셀 내보내기", () => {
  const d = sample();
  const r = solve(d);
  it("전체 시트 두 개와 날짜별 감독표를 만든다", () => {
    const sheets = buildWorkbook(d, r.assignments, {
      dates: d.dates.map((x) => x.date),
      layout: "combined",
      overview: true,
    });
    expect(sheets.map((s) => s.name)).toEqual([
      "교사별 전체",
      "고사실별 전체",
      "10.19(월) 감독표",
      "10.20(화) 감독표",
      "10.21(수) 감독표",
    ]);
    const teachers = sheets[0];
    // 2 header rows + one row per teacher; 9 periods + 3 cumulative + score.
    expect(teachers.rows).toHaveLength(2 + d.teachers.length);
    expect(teachers.rows[2]).toHaveLength(2 + 9 + 3 + 1);
    // Every assignment shows up as a room in the teacher's row.
    const filled = teachers.rows
      .slice(2)
      .flatMap((row) => row.slice(2, 11))
      .filter((cell) => cell && !cell.tone && cell.v !== "").length;
    expect(filled).toBe(r.assignments.filter((a) => a.teacherId).length);
    const daily = sheets[2];
    expect(daily.rows[0][0]?.v).toBe("10월 19일(월) 교사별 감독시간표");
    expect(daily.rows[0][5]?.v).toBe("10월 19일(월) 고사실별 감독시간표");
  });
  it("양식을 고르면 해당 표만 만들고 xlsx로 쓴다", async () => {
    const sheets = buildWorkbook(d, r.assignments, {
      dates: [d.dates[0].date],
      layout: "room",
      overview: false,
    });
    expect(sheets.map((s) => s.name)).toEqual(["10.19(월) 감독표 고사실별"]);
    expect(sheets[0].rows[1][0]?.v).toBe("고사실");
    const file = path.join(await mkdtemp(path.join(tmpdir(), "xlsx-")), "t.xlsx");
    await writeWorkbook(sheets, file);
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(file);
    const ws = book.getWorksheet("10.19(월) 감독표 고사실별")!;
    expect(ws.getCell("A1").value).toBe("10월 19일(월) 고사실별 감독시간표");
    expect(ws.pageSetup.orientation).toBe("landscape");
  });
});
