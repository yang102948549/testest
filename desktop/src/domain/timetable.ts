// Class timetables → which teacher teaches in which exam period, so those
// periods can be marked "cannot proctor". Sources: Comcigan or Excel files.
import type { ExamDocument, Teacher } from "./model";
import type { ImportSheet } from "./teacherImport";

export type ComciganSchool = { region: string; name: string; code: number };
type Grid = unknown[][][][]; // [grade][class][weekday][period], index 0 = counts
export type ComciganTimetable = {
  school: string;
  teachers: string[];
  subjects: string[];
  divisor: number;
  viewLimit: string;
  original: Grid;
  weeks: { start: string; daily: Grid }[];
};
export type TimetableLesson = {
  date: string;
  period: number;
  teacher: string;
  subject: string;
  /** Identity of the timetable's teacher. Masked names repeat ("이주*"), so
   *  Comcigan uses its teacher index and Excel uses name + subject. */
  key: string;
};
/** Where the lessons of an exam date came from. */
export type DateSource = {
  date: string;
  source: "week" | "base" | "none";
};

const weekdayOf = (date: string) => new Date(date + "T00:00:00Z").getUTCDay();
const addDays = (date: string, n: number) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Packed cell: last three digits = teacher index, the rest = subject (mod divisor). */
export function decodeCell(value: unknown, divisor = 100) {
  let text = String(value ?? "");
  if (text.startsWith(">")) text = text.slice(1);
  const packed = Number(text);
  if (!Number.isFinite(packed) || packed <= 0) return null;
  const teacher = packed % 1000;
  const subject = Math.floor(packed / 1000) % divisor;
  return teacher > 0 ? { teacher, subject } : null;
}

/**
 * Exam dates inside a week Comcigan serves use that week's actual timetable;
 * other dates fall back to the base weekly timetable by weekday.
 */
export function comciganLessons(
  t: ComciganTimetable,
  dates: ExamDocument["dates"],
) {
  const lessons: TimetableLesson[] = [];
  const sources: DateSource[] = [];
  const limit = /^\d{4}-\d{2}-\d{2}/.test(t.viewLimit) ? t.viewLimit.slice(0, 10) : "";
  for (const day of dates) {
    const weekday = weekdayOf(day.date);
    if (weekday < 1 || weekday > 5) {
      sources.push({ date: day.date, source: "none" });
      continue;
    }
    const week = t.weeks.find(
      (w) => w.start <= day.date && day.date < addDays(w.start, 7),
    );
    const viewable = !limit || limit < "2014" || day.date < limit;
    const grid = week && viewable ? week.daily : t.original;
    sources.push({ date: day.date, source: week && viewable ? "week" : "base" });
    for (let g = 1; g < (grid?.length ?? 0); g++)
      for (let c = 1; c < (grid[g]?.length ?? 0); c++) {
        const cells = grid[g][c]?.[weekday];
        if (!Array.isArray(cells)) continue;
        const count = Math.min(day.periods, Number(cells[0]) || cells.length - 1);
        for (let p = 1; p <= count; p++) {
          const cell = decodeCell(cells[p], t.divisor);
          if (!cell) continue;
          lessons.push({
            date: day.date,
            period: p,
            teacher: String(t.teachers[cell.teacher] ?? ""),
            subject: String(t.subjects[cell.subject] ?? ""),
            key: `comcigan:${cell.teacher}`,
          });
        }
      }
  }
  return { lessons: dedupe(lessons), sources };
}

/**
 * Excel timetables: a header row with day columns ("월(19)" for a dated week,
 * or just "월" for the base timetable), then period rows ("1", "1교시") whose
 * cells read "과목\n교사" or "과목 교사".
 */
export function excelLessons(
  sheets: ImportSheet[],
  dates: ExamDocument["dates"],
) {
  const names = ["일", "월", "화", "수", "목", "금", "토"];
  const lessons: TimetableLesson[] = [];
  const seen = new Map<string, DateSource["source"]>();
  for (const sheet of sheets) {
    let columns = new Map<number, ExamDocument["dates"]>();
    for (const row of sheet.rows) {
      const heads = row.map((cell) =>
        cell.trim().match(/^([일월화수목금토])(?:요일)?\s*(?:\(\s*(\d{1,2})\s*일?\s*\))?$/),
      );
      if (heads.filter(Boolean).length >= 2) {
        columns = new Map();
        heads.forEach((m, j) => {
          if (!m) return;
          const weekday = names.indexOf(m[1]);
          const matched = dates.filter(
            (d) =>
              weekdayOf(d.date) === weekday &&
              (!m[2] || Number(d.date.slice(8)) === Number(m[2])),
          );
          if (matched.length) columns.set(j, matched);
          for (const d of matched)
            if (seen.get(d.date) !== "week") seen.set(d.date, m[2] ? "week" : "base");
        });
        continue;
      }
      const period = Number(row[0]?.trim().match(/^(\d{1,2})\s*(?:교시)?$/)?.[1]);
      if (!period || !columns.size) continue;
      for (const [j, days] of columns) {
        const parts = splitCell(row[j] ?? "");
        if (!parts) continue;
        for (const day of days)
          if (period <= day.periods)
            lessons.push({
              date: day.date,
              period,
              ...parts,
              key: `excel:${parts.teacher}|${parts.subject}`,
            });
      }
    }
  }
  const sources = dates.map((d) => ({
    date: d.date,
    source: seen.get(d.date) ?? ("none" as const),
  }));
  return { lessons: dedupe(lessons), sources };
}

function splitCell(value: string) {
  const text = value.trim();
  if (!text) return null;
  let parts = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) {
    const i = text.lastIndexOf(" ");
    if (i < 0) return null;
    parts = [text.slice(0, i).trim(), text.slice(i + 1).trim()];
  }
  return { subject: parts[0], teacher: parts[parts.length - 1] };
}

const dedupe = (list: TimetableLesson[]) => [
  ...new Map(list.map((l) => [`${l.date}/${l.period}/${l.key}`, l])).values(),
];

const clean = (s: string) => s.replace(/[\s·ⅠⅡⅢIVX0-9()]/g, "");
/** Abbreviations keep their letters in order: 통사 ⊂ 통합사회. */
function subjectLike(a: string, b: string) {
  const [x, y] = [clean(a), clean(b)];
  if (!x || !y) return false;
  const inside = (short: string, long: string) => {
    let i = 0;
    for (const ch of long) if (ch === short[i]) i++;
    return i === short.length;
  };
  return inside(x, y) || inside(y, x);
}

export type TeacherMatch = {
  /** One row per timetable teacher, even when masked names coincide. */
  key: string;
  label: string;
  subjects: string[];
  times: { date: string; period: number }[];
  candidates: Teacher[];
  /** Chosen teacher id; empty when the user must pick. */
  teacherId: string;
};

/**
 * "김수*" = first two letters + three letters long (Comcigan masking);
 * "김수" alone = a short name in an Excel timetable. Ambiguity is narrowed by
 * subject and otherwise left for the user, never guessed.
 */
export function matchTeachers(
  lessons: TimetableLesson[],
  teachers: Teacher[],
): TeacherMatch[] {
  const groups = new Map<string, TimetableLesson[]>();
  for (const l of lessons) {
    if (!l.teacher.replace(/\*/g, "").trim()) continue;
    groups.set(l.key, [...(groups.get(l.key) ?? []), l]);
  }
  const roster = teachers.filter((t) => t.role !== "excluded");
  return [...groups]
    .map(([key, list]) => {
      const label = list[0].teacher;
      const subjects = [...new Set(list.map((l) => l.subject).filter(Boolean))];
      const base = label.replace(/\*/g, "").trim();
      const masked = label.includes("*");
      let candidates = roster.filter((t) => t.name === base);
      if (!candidates.length)
        candidates = roster.filter(
          (t) =>
            t.name.startsWith(base) &&
            (!masked || t.name.length === label.trim().length),
        );
      if (candidates.length > 1) {
        const bySubject = candidates.filter((t) =>
          t.subjects.some((s) => subjects.some((x) => subjectLike(s, x))),
        );
        if (bySubject.length) candidates = bySubject;
      }
      return {
        key,
        label,
        subjects,
        times: list.map(({ date, period }) => ({ date, period })),
        candidates,
        teacherId: candidates.length === 1 ? candidates[0].id : "",
      };
    })
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label, "ko") ||
        a.subjects.join().localeCompare(b.subjects.join(), "ko"),
    );
}

/** Marks matched normal teachers as unable to proctor during their lessons. */
export function applyTimetable(x: ExamDocument, matches: TeacherMatch[]) {
  const all = x.dates.flatMap((d) =>
    Array.from({ length: d.periods }, (_, i) => ({ date: d.date, period: i + 1 })),
  );
  const key = (t: { date: string; period: number }) => `${t.date}/${t.period}`;
  const changed = new Set<string>(),
    skipped = new Set<string>();
  for (const m of matches) {
    const t = x.teachers.find((a) => a.id === m.teacherId);
    if (!t) continue;
    // Designated teachers proctor only on their chosen periods; leave them alone.
    if (t.role !== "normal") {
      skipped.add(t.name);
      continue;
    }
    const busy = new Set(m.times.map(key));
    const base = t.availability ?? all;
    const next = base.filter((a) => !busy.has(key(a)));
    if (next.length === base.length) continue;
    t.availability = next;
    if (!t.exclusionReason?.trim()) t.exclusionReason = "교과수업";
    changed.add(t.id);
  }
  return { changed: changed.size, skipped: [...skipped] };
}

/** Exam slots in a timetable ("고사", "시험") are not classes and never block proctoring. */
export const isExamSubject = (subject: string) =>
  /^(고사|시험|중간고사|기말고사|지필)/.test(subject.replace(/\s/g, ""));
