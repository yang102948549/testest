// Excel export, after the original Apps Script result sheets:
// "교사별 전체 시간표", "고사실별 전체 시간표" and per-day printable sheets
// (combined / teacher only / room only). Pure data; electron/exportXlsx.ts
// turns it into a styled .xlsx.
import { Assignment, ExamDocument, Slot, key } from "./model";
import {
  slotsFor,
  sortedRooms,
  subjectMap,
  unavailableReason,
  weight,
} from "./rules";

export type Tone =
  | "title"
  | "head"
  | "sub"
  | "roomHead"
  | "roomSub"
  | "muted"
  | "missing";
export type XCell = { v: string | number; tone?: Tone } | null;
export type XSheet = {
  name: string;
  rows: XCell[][];
  /** [row, col, lastRow, lastCol], zero-based. */
  merges: [number, number, number, number][];
  freeze?: { rows: number; cols: number };
  widths: number[];
  heights?: Record<number, number>;
  landscape?: boolean;
};
export type ExportOptions = {
  dates: string[];
  layout: "combined" | "teacher" | "room";
  overview: boolean;
};

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const day = (date: string) => new Date(date + "T00:00:00Z");
/** 10/19(월) */
export const shortDay = (date: string) =>
  `${+date.slice(5, 7)}/${+date.slice(8)}(${WEEK[day(date).getUTCDay()]})`;
/** 10월 19일(월) */
const longDay = (date: string) =>
  `${+date.slice(5, 7)}월 ${+date.slice(8)}일(${WEEK[day(date).getUTCDay()]})`;
const c = (v: string | number, tone?: Tone): XCell => ({ v, tone });

export function buildWorkbook(
  d: ExamDocument,
  assignments: Assignment[],
  opts: ExportOptions,
): XSheet[] {
  const slots = slotsFor(d),
    subjects = subjectMap(d),
    mainSub = d.settings.mode === "mainSub";
  const teacherOf = new Map(assignments.map((a) => [a.slotId, a.teacherId]));
  const roomName = new Map(d.rooms.map((r) => [r.id, r.name]));
  const rooms = sortedRooms(d.rooms);
  const dates = d.dates.filter((x) => opts.dates.includes(x.date));
  const teacherName = (id: string | null | undefined) =>
    d.teachers.find((t) => t.id === id)?.name ?? "";
  const dutyText = (s: Slot) =>
    `${roomName.get(s.roomId) ?? ""}${s.kind === "main" ? " 정" : s.kind === "sub" ? " 부" : ""}`;
  const teacherCell = (tid: string, date: string, period: number): XCell => {
    const own = slots.filter(
      (s) => s.date === date && s.period === period && teacherOf.get(s.id) === tid,
    );
    if (own.length) return c(own.map(dutyText).join(", "));
    const t = d.teachers.find((x) => x.id === tid)!;
    const reason = unavailableReason(t, { date, period }, subjects, slots);
    return reason ? c(reason, "muted") : c("");
  };
  const roomCells = (roomId: string, date: string, period: number): XCell[] => {
    const here = slots.filter(
      (s) => s.roomId === roomId && s.date === date && s.period === period,
    );
    const at = (kind: Slot["kind"]) => {
      const s = here.find((x) => x.kind === kind);
      if (!s) {
        if (kind === "sub" && here.length) return c("단독", "muted");
        const selfStudy = d.lessons
          .filter((l) => l.date === date && l.period === period)
          .every((l) => l.subject.trim() === "자습");
        return c(here.length === 0 && selfStudy ? "자습" : "시험 없음", "muted");
      }
      const name = teacherName(teacherOf.get(s.id));
      return name ? c(name) : c("미배정", "missing");
    };
    if (mainSub) return [at("main"), at("sub")];
    return [at(d.rooms.find((r) => r.id === roomId)?.kind === "hallway" ? "hallway" : "classroom")];
  };
  const periodSubjects = (date: string, period: number) =>
    [...(subjects.get(key({ date, period })) ?? [])].join("·");
  const sheets: XSheet[] = [];

  if (opts.overview) {
    // 교사별 전체 시간표
    const width = dates.reduce((n, x) => n + x.periods, 0);
    const top: XCell[] = [c("순", "head"), c("교사명", "head")];
    const second: XCell[] = [c("", "head"), c("", "head")];
    const merges: XSheet["merges"] = [
      [0, 0, 1, 0],
      [0, 1, 1, 1],
    ];
    let col = 2;
    for (const x of dates) {
      merges.push([0, col, 0, col + x.periods - 1]);
      for (let p = 1; p <= x.periods; p++) {
        top.push(c(p === 1 ? shortDay(x.date) : "", "head"));
        second.push(c(`${p}교시`, "sub"));
      }
      col += x.periods;
    }
    merges.push([0, col, 0, col + dates.length - 1]);
    dates.forEach((x, i) => {
      top.push(c(i === 0 ? "날짜별 누적 배정" : "", "head"));
      second.push(c(shortDay(x.date), "sub"));
    });
    col += dates.length;
    top.push(c("배정점수", "head"));
    second.push(c("", "head"));
    merges.push([0, col, 1, col]);
    const rows = d.teachers.map((t, i) => {
      const cells: XCell[] = [c(i + 1), c(t.name)];
      for (const x of dates)
        for (let p = 1; p <= x.periods; p++) cells.push(teacherCell(t.id, x.date, p));
      const mine = slots.filter((s) => teacherOf.get(s.id) === t.id);
      let running = 0;
      for (const x of dates) {
        running += mine.filter((s) => s.date === x.date).length;
        cells.push(c(running));
      }
      cells.push(c(mine.reduce((n, s) => n + weight(d, s), 0)));
      return cells;
    });
    sheets.push({
      name: "교사별 전체",
      rows: [top, second, ...rows],
      merges,
      freeze: { rows: 2, cols: 2 },
      widths: [5, 11, ...Array(width).fill(9), ...Array(dates.length).fill(8), 9],
      landscape: true,
    });

    // 고사실별 전체 시간표
    const per = mainSub ? 2 : 1;
    const rTop: XCell[] = [c("고사실", "roomHead")];
    const rSecond: XCell[] = [c("", "roomHead")];
    const rThird: XCell[] = [c("", "roomHead")];
    const rMerges: XSheet["merges"] = [[0, 0, mainSub ? 2 : 1, 0]];
    let rc = 1;
    for (const x of dates) {
      rMerges.push([0, rc, 0, rc + x.periods * per - 1]);
      for (let p = 1; p <= x.periods; p++) {
        if (mainSub) rMerges.push([1, rc + (p - 1) * 2, 1, rc + (p - 1) * 2 + 1]);
        for (let k = 0; k < per; k++) {
          rTop.push(c(p === 1 && k === 0 ? shortDay(x.date) : "", "roomHead"));
          rSecond.push(c(k === 0 ? `${p}교시` : "", "roomSub"));
          rThird.push(c(k === 0 ? "정감독" : "부감독", "roomSub"));
        }
      }
      rc += x.periods * per;
    }
    const roomRows = rooms.map((r) => {
      const cells: XCell[] = [c(r.name)];
      for (const x of dates)
        for (let p = 1; p <= x.periods; p++) cells.push(...roomCells(r.id, x.date, p));
      return cells;
    });
    sheets.push({
      name: "고사실별 전체",
      rows: [rTop, rSecond, ...(mainSub ? [rThird] : []), ...roomRows],
      merges: rMerges,
      freeze: { rows: mainSub ? 3 : 2, cols: 1 },
      widths: [11, ...Array(rc - 1).fill(9)],
      landscape: true,
    });
  }

  // Per-day printable sheets.
  for (const x of dates) {
    const P = x.periods,
      per = mainSub ? 2 : 1;
    const rows: XCell[][] = [];
    const merges: XSheet["merges"] = [];
    const put = (r: number, col: number, cell: XCell) => {
      rows[r] ??= [];
      rows[r][col] = cell;
    };
    let widths: number[] = [];
    const showTeachers = opts.layout !== "room",
      showRooms = opts.layout !== "teacher";
    if (showTeachers) {
      put(0, 0, c(`${longDay(x.date)} 교사별 감독시간표`, "title"));
      merges.push([0, 0, 0, P]);
      put(1, 0, c("교사명", "head"));
      put(2, 0, c("과목", "sub"));
      for (let p = 1; p <= P; p++) {
        put(0, p, c("", "title"));
        put(1, p, c(`${p}교시`, "head"));
        put(2, p, c(periodSubjects(x.date, p), "sub"));
      }
      d.teachers.forEach((t, i) => {
        put(3 + i, 0, c(t.name));
        for (let p = 1; p <= P; p++) put(3 + i, p, teacherCell(t.id, x.date, p));
      });
      widths = [12, ...Array(P).fill(13)];
    }
    if (showRooms) {
      const at = showTeachers ? P + 2 : 0;
      if (showTeachers) widths.push(3);
      const span = P * per;
      put(0, at, c(`${longDay(x.date)} 고사실별 감독시간표`, "title"));
      merges.push([0, at, 0, at + span]);
      put(1, at, c("고사실", "roomHead"));
      put(2, at, c(mainSub ? "" : "과목", "roomSub"));
      for (let p = 1; p <= P; p++)
        for (let k = 0; k < per; k++) {
          const col = at + 1 + (p - 1) * per + k;
          put(0, col, c("", "title"));
          put(1, col, c(k === 0 ? `${p}교시` : "", "roomHead"));
          put(
            2,
            col,
            c(mainSub ? (k === 0 ? "정감독" : "부감독") : periodSubjects(x.date, p), "roomSub"),
          );
        }
      if (mainSub)
        for (let p = 1; p <= P; p++)
          merges.push([1, at + 1 + (p - 1) * 2, 1, at + 2 + (p - 1) * 2]);
      rooms.forEach((r, i) => {
        put(3 + i, at, c(r.name));
        for (let p = 1; p <= P; p++)
          roomCells(r.id, x.date, p).forEach((cell, k) =>
            put(3 + i, at + 1 + (p - 1) * per + k, cell),
          );
      });
      widths.push(11, ...Array(span).fill(mainSub ? 10 : 12));
    }
    const suffix = opts.layout === "teacher" ? " 교사별" : opts.layout === "room" ? " 고사실별" : "";
    sheets.push({
      name: `${shortDay(x.date).replace("/", ".")} 감독표${suffix}`,
      rows: rows.map((r) => Array.from({ length: r.length }, (_, i) => r[i] ?? null)),
      merges,
      freeze: { rows: 3, cols: 0 },
      widths,
      heights: { 0: 30 },
      landscape: true,
    });
  }
  return sheets;
}
