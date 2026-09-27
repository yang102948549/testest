import ExcelJS from "exceljs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ImportSheet, parseDelimited } from "../src/domain/teacherImport";
export async function readTeacherFile(file: string): Promise<ImportSheet[]> {
  if ((await stat(file)).size > 10_000_000)
    throw new Error("10 MB 이하의 명단 파일을 사용해 주세요.");
  const ext = path.extname(file).toLowerCase();
  if (ext === ".csv" || ext === ".tsv") {
    const bytes = await readFile(file);
    let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (text.includes("\ufffd")) text = new TextDecoder("euc-kr").decode(bytes);
    return [{ name: path.basename(file), rows: parseDelimited(text) }];
  }
  if (ext !== ".xlsx")
    throw new Error(
      "지원 형식은 .xlsx, .csv, .tsv입니다. 이전 .xls 파일은 .xlsx로 저장해 주세요.",
    );
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  return readBook(book);
}
/** Google Sheets link -> exported .xlsx. Only public ("anyone with the link") sheets work. */
export async function readGoogleSheet(link: string): Promise<ImportSheet[]> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new Error("Google Sheets 주소를 확인해 주세요.");
  }
  const id = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/)?.[1];
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !id)
    throw new Error(
      "docs.google.com/spreadsheets/d/… 형식의 Google Sheets 링크를 붙여넣어 주세요.",
    );
  let response: Response;
  try {
    response = await fetch(
      `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`,
      { signal: AbortSignal.timeout(20000) },
    );
  } catch {
    throw new Error("시트를 내려받지 못했습니다. 인터넷 연결을 확인해 주세요.");
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || type.includes("text/html"))
    throw new Error(
      "시트를 열 수 없습니다. Google Sheets의 공유 설정을 ‘링크가 있는 모든 사용자 · 뷰어’로 바꾼 뒤 다시 시도해 주세요.",
    );
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 10_000_000)
    throw new Error("10 MB 이하의 시트만 가져올 수 있습니다.");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  return readBook(book);
}
function readBook(book: ExcelJS.Workbook): ImportSheet[] {
  const sheets: ImportSheet[] = [];
  for (const sheet of book.worksheets) {
    if (sheet.state !== "visible") continue;
    if (sheet.rowCount > 2001 || sheet.columnCount > 100)
      throw new Error(`${sheet.name}: 최대 2,000행·100열을 지원합니다.`);
    const rows: string[][] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      rows.push(
        Array.from({ length: sheet.columnCount }, (_, c) =>
          sheet.getCell(r, c + 1).text.trim(),
        ),
      );
    }
    if (rows.some((r) => r.some(Boolean)))
      sheets.push({ name: sheet.name, rows });
  }
  if (!sheets.length) throw new Error("가져올 내용이 있는 시트가 없습니다.");
  return sheets;
}
