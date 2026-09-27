// Comcigan (컴시간알리미) client. Unofficial API, same approach as
// https://github.com/hegelty/pycomcigan (MIT): the service page carries the
// endpoint and the field codes, and only this week and next week are served.
import type { ComciganSchool, ComciganTimetable } from "../src/domain/timetable";

const BASE = "http://comci.net:4082";
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

async function get(url: string, encoding = "utf-8") {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("컴시간에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.");
  }
  if (!response.ok) throw new Error(`컴시간 응답 오류 (${response.status})`);
  return new TextDecoder(encoding).decode(await response.arrayBuffer());
}

/** Percent-encode text as EUC-KR (CP949) using the built-in decoder in reverse. */
let reverse: Map<string, number[]> | null = null;
export function encodeEucKr(text: string) {
  if (!reverse) {
    reverse = new Map();
    const decoder = new TextDecoder("euc-kr");
    for (let lead = 0x81; lead <= 0xfe; lead++)
      for (let trail = 0x41; trail <= 0xfe; trail++) {
        const ch = decoder.decode(new Uint8Array([lead, trail]));
        if (ch.length === 1 && ch !== "�" && !reverse.has(ch))
          reverse.set(ch, [lead, trail]);
      }
  }
  let out = "";
  for (const ch of text) {
    const bytes = ch.charCodeAt(0) < 0x80 ? [ch.charCodeAt(0)] : reverse.get(ch);
    if (!bytes) continue;
    out += bytes.map((b) => "%" + b.toString(16).toUpperCase().padStart(2, "0")).join("");
  }
  return out;
}

async function serviceCodes() {
  const page = await get(`${BASE}/st`, "euc-kr");
  const find = (label: string, pattern: RegExp) => {
    const m = page.match(pattern);
    if (!m)
      throw new Error(
        `컴시간 페이지 구조가 바뀌어 ${label}을(를) 찾지 못했습니다. 엑셀 시간표로 불러와 주세요.`,
      );
    return m[1];
  };
  return {
    endpoint: find("검색 주소", /\.(\/\d+\?\d+l)/),
    school: find("학교 코드", /sc_data\(\s*'(\d+)_/),
    teacher: find("교사 목록", /성명\s*=\s*(?:Q성명\(\s*)?자료\.자료(\d+)/),
    subject: find("과목 목록", /(?:과목명\s*=\s*(?:Q과목명\(\s*)?)?자료\.자료(\d+)\[sb\]/),
    daily: find("일일 시간표", /일일자료\s*=\s*Q자료\(\s*자료\.자료(\d+)/),
    original: find("기본 시간표", /원자료\s*=\s*Q자료\(\s*자료\.자료(\d+)/),
  };
}

export async function searchSchools(name: string): Promise<ComciganSchool[]> {
  const query = name.trim();
  if (query.length < 2 || query.length > 40)
    throw new Error("학교 이름을 2글자 이상 입력해 주세요.");
  const codes = await serviceCodes();
  const text = await get(BASE + codes.endpoint + encodeEucKr(query));
  const list: unknown[][] =
    JSON.parse(text.replace(/\0/g, "").trim()).학교검색 ?? [];
  return list.map((r) => ({
    region: String(r[1]),
    name: String(r[2]),
    code: Number(r[3]),
  }));
}

export async function fetchTimetable(code: number): Promise<ComciganTimetable> {
  if (!Number.isInteger(code) || code <= 0)
    throw new Error("학교를 다시 선택해 주세요.");
  const codes = await serviceCodes();
  const prefix = codes.endpoint.split("?")[0];
  const week = async (r: number) => {
    const param = Buffer.from(`${codes.school}_${code}_0_${r}`).toString("base64");
    const text = await get(`${BASE}${prefix}?${param}`);
    const end = text.lastIndexOf("}");
    if (end < 0) throw new Error("컴시간에서 시간표를 받지 못했습니다.");
    return JSON.parse(text.slice(0, end + 1));
  };
  const first = await week(1);
  // The service lists the weeks it can serve (usually this week and next).
  const listed: [number, string][] = Array.isArray(first.일자자료)
    ? first.일자자료
    : [[1, ""]];
  const weeks = [];
  for (const [r] of listed.slice(0, 4)) {
    const data = r === 1 ? first : await week(r);
    weeks.push({ start: String(data.시작일), daily: data["자료" + codes.daily] });
  }
  return {
    school: String(first.학교명 ?? ""),
    teachers: first["자료" + codes.teacher],
    subjects: first["자료" + codes.subject],
    divisor: Number(first.분리 ?? 100),
    viewLimit: String(first.열람제한일 ?? ""),
    original: first["자료" + codes.original],
    weeks,
  };
}
