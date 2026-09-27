import { describe, it, expect } from "vitest";
import {
  blank,
  documentSchema,
  ExamDocument,
  fingerprint,
  sample,
  Teacher,
} from "../src/domain/model";
import { solve } from "../src/domain/engine";
import {
  assertManual,
  forbidden,
  slotsFor,
  sortedRooms,
  subjectMap,
  validate,
} from "../src/domain/rules";
const teacher = (id: string, extra: Partial<Teacher> = {}): Teacher => ({
  id,
  name: id,
  subjects: [],
  homeroom: null,
  movingRooms: [],
  role: "normal",
  note: "",
  availability: null,
  exclusions: [],
  ...extra,
});
function tiny(): ExamDocument {
  const d = blank();
  d.dates = [{ date: "2026-10-19", periods: 2 }];
  d.rooms = [
    { id: "r1", name: "1-1", kind: "classroom", grade: 1 },
    { id: "r2", name: "1-2", kind: "classroom", grade: 1 },
  ];
  d.lessons = [
    {
      id: "l1",
      date: d.dates[0].date,
      period: 1,
      grade: 1,
      subject: "수학",
      roomIds: ["r1", "r2"],
    },
  ];
  d.teachers = [teacher("a"), teacher("b")];
  return d;
}
describe("배정 규칙과 엔진", () => {
  it("순차 선택에 갇히는 사례를 재배정해 모두 채운다", () => {
    const d = tiny();
    d.teachers = [teacher("a", { movingRooms: ["r2"] }), teacher("b")];
    const r = solve(d);
    expect(r.assignments.map((a) => a.teacherId)).toEqual(["a", "b"]);
    expect(r.issues).toEqual([]);
  });
  it("작은 사례에서 전수 탐색의 최대 충원 수와 일치한다", () => {
    for (let mask = 0; mask < 16; mask++) {
      const d = tiny();
      d.teachers.forEach((t, i) => {
        t.movingRooms = d.rooms
          .filter((_, j) => mask & (1 << (i * 2 + j)))
          .map((r) => r.id);
      });
      const slots = slotsFor(d);
      let optimum = 0;
      for (const a of [-1, 0, 1])
        for (const b of [-1, 0, 1]) {
          if (a >= 0 && a === b) continue;
          const plan = [a, b];
          if (
            plan.some(
              (ti, si) =>
                ti >= 0 && forbidden(d, d.teachers[ti], slots[si]).length,
            )
          )
            continue;
          optimum = Math.max(optimum, plan.filter((i) => i >= 0).length);
        }
      expect(solve(d).assignments.filter((a) => a.teacherId).length).toBe(
        optimum,
      );
    }
  });
  it("금지 사유를 담당 과목·학급·시간별로 독립 검증한다", () => {
    const d = tiny(),
      s = slotsFor(d)[0];
    const t = teacher("a", {
      subjects: ["국어", "수학"],
      homeroom: "r1",
      movingRooms: ["r1"],
      availability: [],
      exclusions: [{ date: s.date, period: s.period, reason: "출장" }],
    });
    expect(forbidden(d, t, s)).toEqual(
      expect.arrayContaining([
        "담임 학급",
        "이동 학급",
        "담당 과목 시험 교시",
        "감독 불가 교시",
        "감독 불가 교시: 출장",
      ]),
    );
  });
  it("완전 제외·부분 가능 교사에게 금지된 시간을 배정하지 않는다", () => {
    const d = tiny();
    d.teachers = [
      teacher("a", { role: "excluded" }),
      teacher("b", { availability: [{ date: d.dates[0].date, period: 2 }] }),
    ];
    const r = solve(d);
    expect(r.assignments.every((a) => !a.teacherId)).toBe(true);
    expect(r.issues.filter((i) => i.code === "unassigned")).toHaveLength(2);
  });
  it("seed 재현성과 금지 위반 없는 예시 고사", () => {
    const d = sample();
    const a = solve(d),
      b = solve(d);
    expect(a.assignments).toEqual(b.assignments);
    expect(a.issues).toEqual(b.issues);
    expect(a.issues.filter((i) => i.severity === "error")).toEqual([]);
  }, 30000);
  it("동명이인은 ID로 구분하고 변경된 입력을 감지한다", () => {
    const d = tiny();
    d.teachers.forEach((t) => (t.name = "김교사"));
    const r = solve(d);
    expect(new Set(r.assignments.map((a) => a.teacherId)).size).toBe(2);
    d.teachers[0].name = "김교사2";
    expect(r.fingerprint).not.toBe(fingerprint(d));
  });
  it("스키마 파싱과 JSON 왕복의 필드 순서 변경은 입력 변경이 아니다", () => {
    const d = sample();
    expect(fingerprint(d)).toBe(fingerprint(documentSchema.parse(d)));
    expect(fingerprint(d)).toBe(fingerprint(JSON.parse(JSON.stringify(d))));
  });
  it("후보 부족 시 미배정 사유를 남기고 불가능으로 단정하지 않는다", () => {
    const d = tiny();
    d.teachers = d.teachers.slice(0, 1);
    const r = solve(d);
    const issue = r.issues.find((i) => i.code === "unassigned");
    expect(issue?.message).toContain("해결 불가능 판정이 아닙니다");
  });
  it("횟수 상한 초과는 허용하며 수치로 경고한다", () => {
    const d = tiny();
    d.settings.maxClassroom = 0;
    const r = solve(d);
    expect(r.assignments.every((a) => a.teacherId)).toBe(true);
    expect(r.issues.filter((i) => i.code === "classroom-cap")).toHaveLength(2);
    expect(r.issues[0]).toMatchObject({ limit: 0, actual: 1 });
  });
  it("지정배치 미충족과 상충하는 제외를 표시한다", () => {
    const d = tiny();
    d.teachers = [
      teacher("a", {
        role: "designated",
        availability: [{ date: d.dates[0].date, period: 1 }],
        exclusions: [{ date: d.dates[0].date, period: 1, reason: "출장" }],
      }),
      teacher("b"),
    ];
    expect(solve(d).issues.some((i) => i.code === "required")).toBe(true);
  });
  it("일반 자습은 복도 생성 제외, 복도 전담의 교실 배정 허용", () => {
    const d = tiny();
    d.lessons[0].subject = "자습";
    d.rooms.push({ id: "h", name: "복도", kind: "hallway", grade: 1 });
    d.teachers[0].role = "hallway";
    d.teachers[0].availability = [{ date: d.dates[0].date, period: 1 }];
    expect(slotsFor(d)).toHaveLength(2);
    expect(forbidden(d, d.teachers[0], slotsFor(d)[0])).toEqual([]);
  });
  it("정/부 모드의 단독실·자습과 일반 모드 전용 제한을 구분한다", () => {
    const d = tiny();
    d.settings.mode = "mainSub";
    d.settings.maxClassroom = 0;
    d.singleRooms = [{ date: d.dates[0].date, period: 1, roomId: "r1" }];
    d.teachers.push(teacher("c", { role: "hallway" }));
    expect(slotsFor(d).map((s) => s.kind)).toEqual(["main", "main", "sub"]);
    const r = solve(d);
    expect(r.issues.some((i) => i.code.endsWith("-cap"))).toBe(false);
    const s = slotsFor(d).find((s) => s.kind === "main")!;
    expect(forbidden(d, d.teachers[2], s)).toContain("부감독 전담");
    d.lessons[0].subject = "자습";
    expect(slotsFor(d).every((s) => s.selfStudy && s.kind === "main")).toBe(
      true,
    );
  });
  it("수동 중복 배정 및 금지 교환을 거부한다", () => {
    const d = tiny(),
      slots = slotsFor(d);
    expect(() =>
      assertManual(
        d,
        slots.map((s) => ({ slotId: s.id, teacherId: "a" })),
      ),
    ).toThrow("중복");
    d.teachers[0].homeroom = "r1";
    expect(() =>
      assertManual(d, [
        { slotId: slots[0].id, teacherId: "a" },
        { slotId: slots[1].id, teacherId: "b" },
      ]),
    ).toThrow("담임");
  });
  it("이전 일정의 배정과 중복 슬롯을 검출한다", () => {
    const d = tiny(),
      r = solve(d);
    expect(
      validate(d, [...r.assignments, r.assignments[0]]).some(
        (i) => i.code === "duplicate-slot",
      ),
    ).toBe(true);
    d.lessons = [];
    expect(
      validate(d, r.assignments).some((i) => i.code === "unknown-slot"),
    ).toBe(true);
  });
  it("입력 파일의 잘못된 날짜와 연결을 거부한다", () => {
    const d = tiny();
    expect(documentSchema.parse(d)).toEqual(d);
    d.dates[0].date = "2026-02-30";
    expect(documentSchema.safeParse(d).success).toBe(false);
    const d2 = tiny();
    d2.teachers[0].homeroom = "missing";
    expect(documentSchema.safeParse(d2).success).toBe(false);
  });
  it("100명·40실·5일·4교시 성능 및 검증", () => {
    const d = sample(true),
      start = performance.now();
    const r = solve(d);
    const elapsed = performance.now() - start;
    console.log(
      `대규모 배정: ${slotsFor(d).length}자리 / ${elapsed.toFixed(0)}ms / 미배정 ${r.issues.filter((i) => i.code === "unassigned").length}`,
    );
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.assignments).toHaveLength(800);
    expect(elapsed).toBeLessThan(30000);
  }, 40000);
});
describe("고사실 순서", () => {
  it("학년·반 번호 오름차순, 그다음 복도·특별실 순으로 정렬한다", () => {
    const room = (id: string, name: string, grade: number, kind = "classroom") =>
      ({ id, name, grade, kind }) as ExamDocument["rooms"][number];
    const rooms = [
      room("s", "과학실", 1, "special"),
      room("a", "2-1", 2),
      room("h", "본관 복도", 1, "hallway"),
      room("b", "1-10", 1),
      room("c", "1-2", 1),
      room("d", "1-1", 1),
    ];
    expect(sortedRooms(rooms).map((r) => r.name)).toEqual([
      "1-1",
      "1-2",
      "1-10",
      "2-1",
      "본관 복도",
      "과학실",
    ]);
    // The sample registers 1-1, 2-1, 3-1, 1-2… ; slots follow class order.
    const names = new Map(sample().rooms.map((r) => [r.id, r.name]));
    const first = slotsFor(sample()).filter((s) => s.date === "2026-10-19" && s.period === 1);
    expect(first.map((s) => names.get(s.roomId))).toEqual([
      "1-1",
      "1-2",
      "2-1",
      "2-2",
      "3-1",
      "3-2",
      "본관 복도",
    ]);
  });
});
describe("지정배치 교사의 배치 자리", () => {
  const withHall = () => {
    const d = tiny();
    d.rooms.push({ id: "h", name: "복도", kind: "hallway", grade: 1 });
    d.teachers.push(teacher("c"));
    return d;
  };
  const p1 = (d: ExamDocument) => [{ date: d.dates[0].date, period: 1 }];
  const seatOf = (d: ExamDocument, id: string) =>
    solve(d)
      .assignments.filter((a) => a.teacherId === id)
      .map((a) => slotsFor(d).find((s) => s.id === a.slotId)!.kind);
  it("시간강사는 지정 교시에 복도를 먼저 맡는다", () => {
    const d = withHall();
    d.teachers.push(teacher("x", { role: "lecturer", availability: p1(d) }));
    expect(seatOf(d, "x")).toEqual(["hallway"]);
  });
  it("복도 우선은 복도가 차면 교과 감독에 들어간다", () => {
    const d = withHall();
    d.teachers.push(
      teacher("x", { role: "hallway", availability: p1(d) }),
      teacher("y", { role: "lecturer", availability: p1(d) }),
    );
    expect(seatOf(d, "x")).toEqual(["hallway"]);
    expect(seatOf(d, "y")).toEqual(["classroom"]);
  });
  it("복도만은 감독이 부족해도 교과 감독에 넣지 않는다", () => {
    const d = tiny();
    d.teachers = [
      teacher("x", {
        role: "lecturer",
        placement: "hallwayOnly",
        availability: p1(d),
      }),
    ];
    const r = solve(d);
    expect(r.assignments.every((a) => !a.teacherId)).toBe(true);
    expect(r.issues.some((i) => i.code === "required")).toBe(true);
  });
  it("교과 우선이면 복도가 비어 있어도 교과 감독을 맡는다", () => {
    const d = withHall();
    d.teachers.push(
      teacher("x", {
        role: "support",
        placement: "classroomFirst",
        availability: p1(d),
      }),
    );
    expect(seatOf(d, "x")).toEqual(["classroom"]);
  });
  it("지정 교시 밖에는 배정하지 않고 지정이 없으면 알린다", () => {
    const d = tiny();
    d.dates[0].periods = 2;
    d.lessons.push({ ...d.lessons[0], id: "l2", period: 2 });
    d.teachers = [teacher("x", { role: "roaming", availability: p1(d) })];
    d.teachers.push(teacher("y", { role: "roaming" }));
    const r = solve(d);
    const slots = slotsFor(d);
    for (const a of r.assignments.filter((a) => a.teacherId === "x"))
      expect(slots.find((s) => s.id === a.slotId)!.period).toBe(1);
    expect(r.assignments.some((a) => a.teacherId === "y")).toBe(false);
    expect(r.issues.some((i) => i.code === "no-designation")).toBe(true);
  });
  it("이전 역할 이름을 새 분류로 읽는다", () => {
    const d = tiny() as unknown as { teachers: { role: string }[] };
    d.teachers[0].role = "required";
    d.teachers[1].role = "priority";
    const parsed = documentSchema.parse(d);
    expect(parsed.teachers.map((t) => t.role)).toEqual([
      "designated",
      "lecturer",
    ]);
  });
});
