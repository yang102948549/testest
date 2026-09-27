// Styled .xlsx from the pure sheet description in src/domain/exportBook.ts.
// Colours follow the original Apps Script sheets: dark title bars, a blue
// teacher table, a red room table, gray "no duty" reasons.
import ExcelJS from "exceljs";
import type { Tone, XSheet } from "../src/domain/exportBook";

const FONT = "맑은 고딕";
const fill = (argb: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});
const tones: Record<Tone, Partial<ExcelJS.Style>> = {
  title: { fill: fill("FF434343"), font: { name: FONT, bold: true, size: 14, color: { argb: "FFFFFFFF" } } },
  head: { fill: fill("FFEAF1F7"), font: { name: FONT, bold: true, size: 11, color: { argb: "FF1A3353" } } },
  sub: { fill: fill("FFF4F8FB"), font: { name: FONT, size: 10, color: { argb: "FF1A3353" } } },
  roomHead: { fill: fill("FFF7ECEA"), font: { name: FONT, bold: true, size: 11, color: { argb: "FF8E2A22" } } },
  roomSub: { fill: fill("FFFBF5F4"), font: { name: FONT, size: 10, color: { argb: "FF8E2A22" } } },
  muted: { fill: fill("FFF3F3F3"), font: { name: FONT, size: 10, color: { argb: "FF808080" } } },
  missing: { fill: fill("FFFDECEA"), font: { name: FONT, bold: true, size: 11, color: { argb: "FFC0392B" } } },
};
const line: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFBFBFBF" } };

function validate(input: unknown): XSheet[] {
  if (!Array.isArray(input) || input.length > 80)
    throw new Error("내보낼 시트가 올바르지 않습니다.");
  for (const s of input as XSheet[]) {
    if (typeof s?.name !== "string" || !Array.isArray(s.rows) || s.rows.length > 3000)
      throw new Error("내보낼 시트가 올바르지 않습니다.");
    if (s.rows.some((r) => !Array.isArray(r) || r.length > 1000))
      throw new Error("내보낼 시트가 너무 큽니다.");
  }
  return input as XSheet[];
}

export async function writeWorkbook(input: unknown, file: string) {
  const sheets = validate(input);
  const book = new ExcelJS.Workbook();
  book.creator = "시험감독";
  const used = new Set<string>();
  for (const s of sheets) {
    let name = s.name.replace(/[\\/?*[\]:]/g, ".").slice(0, 31) || "시트";
    for (let i = 2; used.has(name); i++) name = `${name.slice(0, 28)} ${i}`;
    used.add(name);
    const ws = book.addWorksheet(name, {
      views: s.freeze
        ? [{ state: "frozen", xSplit: s.freeze.cols, ySplit: s.freeze.rows }]
        : [],
      pageSetup: {
        orientation: s.landscape ? "landscape" : "portrait",
        paperSize: 9, // A4
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      },
    });
    s.widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    s.rows.forEach((row, r) => {
      const xr = ws.getRow(r + 1);
      xr.height = s.heights?.[r] ?? 22;
      row.forEach((cell, col) => {
        if (!cell) return;
        const xc = xr.getCell(col + 1);
        xc.value = cell.v;
        xc.font = { name: FONT, size: 11 };
        xc.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        xc.border = { top: line, left: line, bottom: line, right: line };
        if (cell.tone) Object.assign(xc, tones[cell.tone]);
      });
    });
    for (const [r1, c1, r2, c2] of s.merges ?? [])
      if (r2 > r1 || c2 > c1) ws.mergeCells(r1 + 1, c1 + 1, r2 + 1, c2 + 1);
  }
  await book.xlsx.writeFile(file);
}
