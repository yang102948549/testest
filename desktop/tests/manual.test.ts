import { describe, it, expect } from "vitest";
import { blank, Teacher } from "../src/domain/model";
import {
  slotsFor,
  forbidden,
  assertManual,
  subjectMap,
} from "../src/domain/rules";
import { previewTeacherSwap } from "../src/domain/manual";
const teacher = (id: string): Teacher => ({
  id,
  name: id,
  subjects: [],
  homeroom: null,
  movingRooms: [],
  role: "normal",
  note: "",
  availability: null,
  exclusions: [],
});
function fixture() {
  const d = blank();
  d.dates = [{ date: "2026-10-19", periods: 2 }];
  d.rooms = [
    { id: "r1", name: "1-1", grade: 1, kind: "classroom" },
    { id: "r2", name: "1-2", grade: 1, kind: "classroom" },
  ];
  d.lessons = [
    {
      id: "l",
      date: d.dates[0].date,
      period: 1,
      grade: 1,
      subject: "수학",
      roomIds: ["r1", "r2"],
    },
  ];
  d.teachers = [teacher("a"), teacher("b"), teacher("c")];
  const slots = slotsFor(d),
    plan = slots.map((s, i) => ({
      slotId: s.id,
      teacherId: i === 0 ? "a" : "b",
    }));
  const a = { teacherId: "a", date: d.dates[0].date, period: 1 },
    b = { ...a, teacherId: "b" };
  return { d, plan, a, b };
}
describe("원본 교사별 표 맞교환", () => {
  it("같은 교시의 두 감독을 교환하되 원본 계획은 변경하지 않는다", () => {
    const { d, plan, a, b } = fixture();
    const result = previewTeacherSwap(d, plan, a, b);
    expect(result.reasons).toEqual([]);
    expect(result.assignments.map((x) => x.teacherId)).toEqual(["b", "a"]);
    expect(plan.map((x) => x.teacherId)).toEqual(["a", "b"]);
    expect(() => assertManual(d, result.assignments)).not.toThrow();
  });
  it("빈 교사 셀로 감독을 이동할 수 있다", () => {
    const { d, plan, a } = fixture();
    const result = previewTeacherSwap(d, plan, a, { ...a, teacherId: "c" });
    expect(result.reasons).toEqual([]);
    expect(result.assignments.map((x) => x.teacherId)).toEqual(["c", "b"]);
  });
  it("다른 교시, 같은 교사, 두 빈칸 교환을 막는다", () => {
    const { d, plan, a, b } = fixture();
    expect(
      previewTeacherSwap(d, plan, a, { ...b, period: 2 }).reasons.join(),
    ).toContain("같은 날짜");
    expect(previewTeacherSwap(d, plan, a, a).reasons.join()).toContain(
      "다른 두 교사",
    );
    expect(previewTeacherSwap(d, [], a, b).reasons.join()).toContain("모두");
  });
  it("담임·제외 교시 등 교환 불가 사유를 미리 표시한다", () => {
    const { d, plan, a, b } = fixture();
    d.teachers[1].homeroom = "r1";
    expect(previewTeacherSwap(d, plan, a, b).reasons.join()).toContain("담임");
    d.teachers[1].exclusions = [{ date: a.date, period: 1, reason: "출장" }];
    expect(previewTeacherSwap(d, plan, a, b).reasons.join()).toContain("출장");
  });
  it("원본 과목 입력의 쉼표·슬래시 복수 과목을 모두 검사한다", () => {
    const { d } = fixture();
    d.lessons[0].subject = "물리, 화학 / 생명과학";
    d.teachers[0].subjects = ["화학"];
    expect(subjectMap(d).get("2026-10-19/1")).toEqual(
      new Set(["물리", "화학", "생명과학"]),
    );
    expect(forbidden(d, d.teachers[0], slotsFor(d)[0])).toContain(
      "담당 과목 시험 교시",
    );
  });
});
