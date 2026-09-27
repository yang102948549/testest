import { describe, expect, it } from "vitest";
import { blank, Teacher } from "../src/domain/model";
import {
  ComciganTimetable,
  applyTimetable,
  comciganLessons,
  decodeCell,
  excelLessons,
  isExamSubject,
  matchTeachers,
} from "../src/domain/timetable";
import { encodeEucKr } from "../electron/comcigan";

const teacher = (id: string, name: string, extra: Partial<Teacher> = {}): Teacher => ({
  id,
  name,
  subjects: [],
  homeroom: null,
  movingRooms: [],
  role: "normal",
  note: "",
  availability: null,
  exclusions: [],
  ...extra,
});
// grade 1, class 1; weekday 1 (Mon) and 2 (Tue); cell = subject*1000 + teacher
const grid = (mon: number[], tue: number[]) => [
  [],
  [[], [5, [mon.length, ...mon], [tue.length, ...tue]]],
];
const comci = (): ComciganTimetable => ({
  school: "테스트고",
  teachers: ["", "김수*", "김수*", "이영*"],
  subjects: ["", "수학", "국어", "고사"],
  divisor: 100,
  viewLimit: "1899-12-30",
  original: grid([1001, 0, 2003], [2002, 0, 0]) as never,
  weeks: [{ start: "2026-10-05", daily: grid([3001, 3002, 0], [0, 0, 0]) as never }],
});

describe("시간표 불러오기", () => {
  it("컴시간 칸은 뒤 세 자리가 교사, 앞자리가 과목이다", () => {
    expect(decodeCell(2003)).toEqual({ teacher: 3, subject: 2 });
    expect(decodeCell(">1001")).toEqual({ teacher: 1, subject: 1 });
    expect(decodeCell(0)).toBeNull();
  });
  it("제공 주간은 실제 시간표, 그 밖은 기본 시간표를 요일로 쓴다", () => {
    const { lessons, sources } = comciganLessons(comci(), [
      { date: "2026-10-05", periods: 3 }, // Mon, served week
      { date: "2026-10-19", periods: 3 }, // Mon, base timetable
      { date: "2026-10-17", periods: 3 }, // Sat
    ]);
    expect(sources.map((s) => s.source)).toEqual(["week", "base", "none"]);
    const at = (date: string) =>
      lessons.filter((l) => l.date === date).map((l) => [l.period, l.teacher, l.subject]);
    expect(at("2026-10-05")).toEqual([[1, "김수*", "고사"], [2, "김수*", "고사"]]);
    expect(at("2026-10-19")).toEqual([[1, "김수*", "수학"], [3, "이영*", "국어"]]);
    expect(isExamSubject("고사")).toBe(true);
    expect(isExamSubject("수학")).toBe(false);
  });
  it("엑셀은 날짜가 있는 요일 머리글과 요일만 있는 기본 시간표를 모두 읽는다", () => {
    const dates = [
      { date: "2026-10-19", periods: 3 },
      { date: "2026-10-20", periods: 3 },
    ];
    const dated = excelLessons(
      [{ name: "1학년", rows: [["", "월(19)", "화(20)"], ["1교시", "국어\n김민서", "수학 이서준"], ["2", "", "영어\n박지"]] }],
      dates,
    );
    expect(dated.sources.map((s) => s.source)).toEqual(["week", "week"]);
    expect(dated.lessons.map((l) => [l.date, l.period, l.teacher])).toEqual([
      ["2026-10-19", 1, "김민서"],
      ["2026-10-20", 1, "이서준"],
      ["2026-10-20", 2, "박지"],
    ]);
    const base = excelLessons([{ name: "기본", rows: [["교시", "월", "화"], ["1", "국어 김민서", ""]] }], dates);
    expect(base.sources[0].source).toBe("base");
    expect(base.lessons).toHaveLength(1);
  });
  it("가려진 이름은 길이와 과목으로 좁히고, 애매하면 고르게 둔다", () => {
    const roster = [
      teacher("a", "김수현", { subjects: ["수학"] }),
      teacher("b", "김수진", { subjects: ["통합사회"] }),
      teacher("c", "이영희"),
      teacher("d", "박지훈"),
      teacher("e", "박지민"),
    ];
    const lesson = (t: string, subject: string) => ({ date: "2026-10-19", period: 1, teacher: t, subject, key: `excel:${t}|${subject}` });
    const m = matchTeachers(
      [lesson("김수*", "수학"), lesson("이영*", "국어"), lesson("최가*", "음악"), lesson("박지", "체육"), lesson("김수현", "통사")],
      roster,
    );
    expect(m.map((x) => x.key)).toContain("excel:김수*|수학");
    const by = Object.fromEntries(m.map((x) => [x.label, x]));
    expect(by["김수*"].teacherId).toBe("a");
    expect(by["이영*"].teacherId).toBe("c");
    expect(by["최가*"].candidates).toEqual([]);
    expect(by["박지"].teacherId).toBe("");
    expect(by["박지"].candidates.map((t) => t.id)).toEqual(["d", "e"]);
    expect(by["김수현"].teacherId).toBe("a");
  });
  it("일반 교사에만 수업 교시를 불가로 더하고 기존 체크와 사유를 지킨다", () => {
    const d = blank();
    d.dates = [{ date: "2026-10-19", periods: 2 }];
    d.teachers = [
      teacher("a", "김수현", { availability: [{ date: "2026-10-19", period: 2 }], exclusionReason: "출장" }),
      teacher("b", "이영희"),
      teacher("c", "박지훈", { role: "lecturer" }),
    ];
    const times = [{ date: "2026-10-19", period: 1 }];
    const r = applyTimetable(d, [
      { key: "a", label: "김수*", subjects: [], times, candidates: [], teacherId: "a" },
      { key: "b", label: "이영*", subjects: [], times, candidates: [], teacherId: "b" },
      { key: "c", label: "박지*", subjects: [], times, candidates: [], teacherId: "c" },
    ]);
    // 김수현 already cannot proctor period 1, so only 이영희 changes.
    expect(r).toEqual({ changed: 1, skipped: ["박지훈"] });
    expect(d.teachers[0].availability).toEqual([{ date: "2026-10-19", period: 2 }]);
    expect(d.teachers[0].exclusionReason).toBe("출장");
    expect(d.teachers[1].availability).toEqual([{ date: "2026-10-19", period: 2 }]);
    expect(d.teachers[1].exclusionReason).toBe("교과수업");
    expect(d.teachers[2].availability).toBeNull();
  });
  it("학교 검색어를 EUC-KR로 인코딩한다", () => {
    expect(encodeEucKr("경기")).toBe("%B0%E6%B1%E2");
    expect(encodeEucKr("A고")).toBe("%41%B0%ED");
  });
  it("가려진 이름이 같은 두 교사는 따로 불러와 과목으로 각각 연결한다", () => {
    const t = comci();
    t.teachers = ["", "이주*", "이주*"];
    t.subjects = ["", "국어", "수학"];
    t.original = grid([1001, 2002, 0], [0, 0, 0]) as never;
    const { lessons } = comciganLessons(t, [{ date: "2026-10-19", periods: 3 }]);
    const roster = [
      teacher("k", "이주원", { subjects: ["국어"] }),
      teacher("m", "이주희", { subjects: ["수학"] }),
    ];
    const m = matchTeachers(lessons, roster);
    expect(m.map((x) => [x.label, x.subjects, x.teacherId])).toEqual([
      ["이주*", ["국어"], "k"],
      ["이주*", ["수학"], "m"],
    ]);
    const d = blank();
    d.dates = [{ date: "2026-10-19", periods: 3 }];
    d.teachers = roster;
    expect(applyTimetable(d, m).changed).toBe(2);
    expect(d.teachers.map((x) => x.availability!.map((a) => a.period))).toEqual([
      [2, 3],
      [1, 3],
    ]);
  });
});
