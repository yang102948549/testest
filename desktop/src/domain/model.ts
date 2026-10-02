import { z } from "zod";

const id = z.string().min(1).max(120);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return !isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
  }, "유효하지 않은 날짜");
const time = z.object({ date, period: z.number().int().min(1).max(12) });
export const teacherSchema = z.object({
  id,
  name: z.string().min(1).max(100),
  subjects: z.array(z.string().max(100)),
  homeroom: id.nullable(),
  movingRooms: z.array(id),
  // v1.1 names: required -> designated, priority -> lecturer.
  role: z.preprocess(
    (v) =>
      v === "required" ? "designated" : v === "priority" ? "lecturer" : v,
    z.enum([
      "normal",
      "designated",
      "lecturer",
      "support",
      "roaming",
      "hallway",
      "excluded",
    ]),
  ),
  // Seat preference for designated teachers; absent means the role default.
  placement: z
    .enum(["hallwayOnly", "hallwayFirst", "classroomFirst", "any"])
    .optional(),
  note: z.string().max(1000),
  // Import problems the user still has to fix (unknown class, unknown role, …).
  review: z.array(z.string().max(300)).max(20).optional(),
  exclusionReason: z.string().max(1000).optional(),
  availability: z.array(time).nullable(),
  exclusions: z.array(time.extend({ reason: z.string().max(1000) })),
});
const roomSchema = z.object({
  id,
  name: z.string().min(1).max(100),
  grade: z.number().int().min(1).max(3),
  kind: z.enum(["classroom", "special", "hallway"]),
});
const lessonSchema = time.extend({
  id,
  grade: z.number().int().min(1).max(3),
  subject: z.string().min(1).max(100),
  roomIds: z.array(id),
});
export const settingsSchema = z.object({
  mode: z.enum(["general", "mainSub"]),
  classroomWeight: z.number().finite().min(0),
  hallwayWeight: z.number().finite().min(0),
  maxClassroom: z.number().int().min(0).max(1000),
  maxHallway: z.number().int().min(0).max(12),
  allowThird: z.boolean(),
  seed: z.number().int().min(0).max(2147483647),
});
const issueSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  code: z.string(),
  message: z.string(),
  slotId: z.string().optional(),
  teacherId: z.string().optional(),
  date: z.string().optional(),
  limit: z.number().optional(),
  actual: z.number().optional(),
});
const assignmentSchema = z.object({ slotId: id, teacherId: id.nullable() });
const resultSchema = z.object({
  engine: z.string(),
  seed: z.number(),
  fingerprint: z.string(),
  assignments: z.array(assignmentSchema),
  issues: z.array(issueSchema),
  createdAt: z.string(),
  optimization: z
    .object({
      status: z.enum(["optimal", "feasible"]),
      completed: z.array(z.string()),
      stoppedAt: z.string().optional(),
      reason: z.enum(["time-limit", "solver-limit"]).optional(),
      elapsedMs: z.number().nonnegative(),
      scoreRange: z.number().nonnegative(),
      absoluteDeviation: z.number().nonnegative(),
    })
    .optional(),
});
export const documentSchema = z
  .object({
    version: z.literal(1),
    id,
    title: z.string().min(1).max(200),
    // School picked from Comcigan; optional so older files still open.
    school: z
      .object({
        code: z.number().int().positive(),
        name: z.string().min(1).max(100),
        region: z.string().max(100),
      })
      .optional(),
    dates: z
      .array(z.object({ date, periods: z.number().int().min(1).max(12) }))
      .max(60),
    rooms: z.array(roomSchema).max(300),
    lessons: z.array(lessonSchema).max(10000),
    teachers: z.array(teacherSchema).max(1000),
    singleRooms: z.array(time.extend({ roomId: id })),
    settings: settingsSchema,
    result: resultSchema.nullable(),
    updatedAt: z.string(),
  })
  .superRefine((d, ctx) => {
    const bad = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    for (const [name, list] of [
      ["교사", d.teachers],
      ["고사실", d.rooms],
      ["시험", d.lessons],
    ] as const)
      if (new Set(list.map((x) => x.id)).size !== list.length)
        bad(`${name} ID 중복`);
    if (new Set(d.dates.map((x) => x.date)).size !== d.dates.length)
      bad("시험 날짜 중복");
    const rooms = new Set(d.rooms.map((r) => r.id));
    const validTime = (t: { date: string; period: number }) =>
      d.dates.some((x) => x.date === t.date && t.period <= x.periods);
    for (const l of d.lessons) {
      if (!validTime(l)) bad("시험 일정의 날짜 또는 교시가 없습니다");
      if (
        l.roomIds.some(
          (r) =>
            !d.rooms.some(
              (x) =>
                x.id === r && x.kind === "classroom" && x.grade === l.grade,
            ),
        )
      )
        bad("과목의 학년·고사실 연결이 잘못되었습니다");
    }
    for (const t of d.teachers) {
      if (
        (t.homeroom && !rooms.has(t.homeroom)) ||
        t.movingRooms.some((r) => !rooms.has(r))
      )
        bad("교사의 학급 연결이 잘못되었습니다");
      if (
        [...(t.availability ?? []), ...t.exclusions].some((x) => !validTime(x))
      )
        bad("교사 가능·제외 시간의 일정이 없습니다");
    }
    if (d.singleRooms.some((x) => !rooms.has(x.roomId) || !validTime(x)))
      bad("단독 감독실 연결이 잘못되었습니다");
  });
export type ExamDocument = z.infer<typeof documentSchema>;
export type Teacher = z.infer<typeof teacherSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
export type Result = z.infer<typeof resultSchema>;
export type Slot = {
  id: string;
  date: string;
  period: number;
  roomId: string;
  kind: "classroom" | "hallway" | "main" | "sub";
  selfStudy: boolean;
};
export const uid = () => crypto.randomUUID();
export const key = (t: { date: string; period: number }) =>
  `${t.date}/${t.period}`;
export function blank(): ExamDocument {
  return {
    version: 1,
    id: uid(),
    title: "새 고사",
    dates: [],
    rooms: [],
    lessons: [],
    teachers: [],
    singleRooms: [],
    settings: {
      mode: "general",
      classroomWeight: 2,
      hallwayWeight: 1,
      maxClassroom: 6,
      maxHallway: 1,
      allowThird: false,
      seed: 2026,
    },
    result: null,
    updatedAt: new Date().toISOString(),
  };
}
export function fingerprint(d: ExamDocument): string {
  // Full canonical input, not a short collision-prone hash. Names do not affect eligibility but remain auditable.
  return JSON.stringify(
    {
      dates: d.dates,
      rooms: d.rooms,
      lessons: d.lessons,
      teachers: d.teachers,
      singleRooms: d.singleRooms,
      settings: d.settings,
    },
    (_key, value) => {
      if (value && typeof value === "object" && !Array.isArray(value))
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, value[k]]),
        );
      return value;
    },
  );
}
export function sample(large = false): ExamDocument {
  const d = blank();
  d.title = large ? "대규모 검증 고사" : "2026학년도 2학기 중간고사";
  d.dates = Array.from({ length: large ? 5 : 3 }, (_, i) => ({
    date: `2026-10-${String(19 + i).padStart(2, "0")}`,
    periods: large ? 4 : 3,
  }));
  d.rooms = Array.from({ length: large ? 40 : 6 }, (_, i) => ({
    id: `r${i}`,
    name: `${(i % 3) + 1}-${Math.floor(i / 3) + 1}`,
    grade: (i % 3) + 1,
    kind: "classroom" as const,
  }));
  if (!large)
    d.rooms.push({ id: "hall", name: "본관 복도", grade: 1, kind: "hallway" });
  const subjects = [
    "국어",
    "수학",
    "영어",
    "사회",
    "과학",
    "역사",
    "음악",
    "미술",
  ];
  d.teachers = Array.from({ length: large ? 100 : 24 }, (_, i) => ({
    id: `t${i}`,
    name: large
      ? `교사 ${String(i + 1).padStart(3, "0")}`
      : [
          "김민서",
          "이서준",
          "박지우",
          "최서연",
          "정하준",
          "강도윤",
          "조수빈",
          "윤지호",
          "장예린",
          "임현우",
          "한소윤",
          "오유진",
          "서준호",
          "신예은",
          "권지훈",
          "황수아",
          "안민준",
          "송지안",
          "류서현",
          "전시우",
          "홍다은",
          "고은우",
          "문채원",
          "양도현",
        ][i],
    subjects: [subjects[i % subjects.length]],
    homeroom: i < d.rooms.length ? d.rooms[i].id : null,
    movingRooms: [],
    role: "normal",
    note: "",
    availability: null,
    exclusions: [],
  }));
  d.dates.forEach((x, day) => {
    for (let p = 1; p <= x.periods; p++)
      for (let g = 1; g <= 3; g++)
        d.lessons.push({
          id: `l${day}-${p}-${g}`,
          date: x.date,
          period: p,
          grade: g,
          subject: subjects[(day * 3 + p + g) % subjects.length],
          roomIds: d.rooms
            .filter((r) => r.kind === "classroom" && r.grade === g)
            .map((r) => r.id),
        });
  });
  return d;
}
