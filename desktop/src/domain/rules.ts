import { Assignment, ExamDocument, Issue, Slot, Teacher, key } from "./model";

type Room = ExamDocument["rooms"][number];
const kindOrder: Record<Room["kind"], number> = { classroom: 0, hallway: 1, special: 2 };
/** Original sheet order: classrooms by grade then class number (1-1, 1-2, … 1-10),
 *  then hallway areas, then special rooms. */
export function compareRooms(a: Room, b: Room) {
  return (
    kindOrder[a.kind] - kindOrder[b.kind] ||
    (a.kind === "classroom" ? a.grade - b.grade : 0) ||
    a.name.localeCompare(b.name, "ko", { numeric: true })
  );
}
export const sortedRooms = (rooms: Room[]) => [...rooms].sort(compareRooms);
export function slotsFor(d: ExamDocument): Slot[] {
  const slots: Slot[] = [];
  for (const day of [...d.dates].sort((a, b) => a.date.localeCompare(b.date)))
    for (let p = 1; p <= day.periods; p++) {
      const ls = d.lessons.filter((l) => l.date === day.date && l.period === p);
      if (!ls.length) continue;
      const selfStudy = ls.every((l) => l.subject.trim() === "자습");
      const selected = new Set(ls.flatMap((l) => l.roomIds));
      for (const r of sortedRooms(d.rooms)) {
        if (r.kind === "classroom" && !selected.has(r.id)) continue;
        if (
          r.kind === "hallway" &&
          (selfStudy || d.settings.mode === "mainSub")
        )
          continue;
        const kinds: Slot["kind"][] =
          d.settings.mode === "general"
            ? [r.kind === "hallway" ? "hallway" : "classroom"]
            : selfStudy ||
                d.singleRooms.some(
                  (x) =>
                    x.date === day.date && x.period === p && x.roomId === r.id,
                )
              ? ["main"]
              : ["main", "sub"];
        for (const kind of kinds)
          slots.push({
            id: `${day.date}/${p}/${r.id}/${kind}`,
            date: day.date,
            period: p,
            roomId: r.id,
            kind,
            selfStudy,
          });
      }
    }
  return slots;
}
export function subjectMap(d: ExamDocument) {
  const m = new Map<string, Set<string>>();
  for (const l of d.lessons) {
    const k = key(l);
    if (!m.has(k)) m.set(k, new Set());
    l.subject
      .split(/[,/]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => m.get(k)!.add(s));
  }
  return m;
}
export function forbidden(
  d: ExamDocument,
  t: Teacher,
  s: Slot,
  subjects = subjectMap(d),
): string[] {
  const reasons: string[] = [];
  if (t.role === "excluded") reasons.push("감독 제외");
  const listed = t.availability?.some((x) => key(x) === key(s)) ?? false;
  if (isDesignated(t)) {
    if (!listed) reasons.push("지정 교시 아님");
  } else if (t.availability !== null && !listed)
    reasons.push(
      `감독 불가 교시${t.exclusionReason ? `: ${t.exclusionReason}` : ""}`,
    );
  // Legacy exclusions from v1.0 files still block until the cell is edited.
  const exclusion = t.exclusions.find((x) => key(x) === key(s));
  if (exclusion)
    reasons.push(
      `감독 불가 교시${exclusion.reason ? `: ${exclusion.reason}` : ""}`,
    );
  if (t.homeroom === s.roomId) reasons.push("담임 학급");
  if (t.movingRooms.includes(s.roomId)) reasons.push("감독불가학급");
  if (t.subjects.some((x) => subjects.get(key(s))?.has(x.trim())))
    reasons.push("담당 과목 시험 교시");
  if (
    placementOf(t) === "hallwayOnly" &&
    !s.selfStudy &&
    (s.kind === "classroom" || s.kind === "main")
  )
    reasons.push(
      d.settings.mode === "mainSub" ? "부감독 전담" : "복도 전담",
    );
  return reasons;
}
/** Every role except normal and excluded proctors only on checked (designated) periods. */
export function isDesignated(t: Teacher) {
  return t.role !== "normal" && t.role !== "excluded";
}
export type Placement = NonNullable<Teacher["placement"]>;
export const defaultPlacement: Record<Teacher["role"], Placement> = {
  normal: "any",
  designated: "any",
  lecturer: "hallwayFirst",
  support: "hallwayFirst",
  roaming: "any",
  hallway: "hallwayOnly",
  excluded: "any",
};
export function placementOf(t: Teacher): Placement {
  return isDesignated(t) ? (t.placement ?? defaultPlacement[t.role]) : "any";
}
/** 0 when the slot matches the teacher's seat preference, 1 otherwise. */
export function placementCost(t: Teacher, s: Slot) {
  const secondary = s.kind === "hallway" || s.kind === "sub";
  if (!isDesignated(t)) return secondary ? 1 : 0;
  const p = placementOf(t);
  if (p === "any") return 0;
  return (p === "classroomFirst") === secondary ? 1 : 0;
}
export function weight(d: ExamDocument, s: Slot) {
  return d.settings.mode === "mainSub"
    ? 1
    : s.kind === "hallway"
      ? d.settings.hallwayWeight
      : d.settings.classroomWeight;
}
export function requiredTimes(d: ExamDocument, t: Teacher, slots: Slot[]) {
  if (!isDesignated(t)) return [];
  // Designated teachers must proctor on every checked period that has an exam.
  const active = new Set(slots.map(key));
  return (t.availability ?? []).filter((x) => active.has(key(x)));
}
export function validate(d: ExamDocument, assignments: Assignment[]): Issue[] {
  const slots = slotsFor(d),
    bySlot = new Map(slots.map((s) => [s.id, s])),
    teachers = new Map(d.teachers.map((t) => [t.id, t]));
  const issues: Issue[] = [],
    seen = new Set<string>(),
    occupied = new Set<string>(),
    subject = subjectMap(d);
  const perTeacher = new Map<string, Slot[]>();
  for (const a of assignments) {
    const s = bySlot.get(a.slotId);
    if (!s) {
      issues.push({
        severity: "error",
        code: "unknown-slot",
        slotId: a.slotId,
        message: "현재 일정에 없는 배정 자리입니다.",
      });
      continue;
    }
    if (seen.has(s.id))
      issues.push({
        severity: "error",
        code: "duplicate-slot",
        slotId: s.id,
        message: "동일 자리가 중복 저장되었습니다.",
      });
    seen.add(s.id);
    if (!a.teacherId) continue;
    const t = teachers.get(a.teacherId);
    if (!t) {
      issues.push({
        severity: "error",
        code: "unknown-teacher",
        slotId: s.id,
        message: "삭제되었거나 존재하지 않는 교사입니다.",
      });
      continue;
    }
    for (const reason of forbidden(d, t, s, subject))
      issues.push({
        severity: "error",
        code: "forbidden",
        teacherId: t.id,
        slotId: s.id,
        date: s.date,
        message: `${t.name} · ${s.date} ${s.period}교시: ${reason}`,
      });
    const busy = `${t.id}/${key(s)}`;
    if (occupied.has(busy))
      issues.push({
        severity: "error",
        code: "double-booking",
        teacherId: t.id,
        slotId: s.id,
        date: s.date,
        message: `${t.name} · ${s.date} ${s.period}교시 중복 배정`,
      });
    occupied.add(busy);
    if (!perTeacher.has(t.id)) perTeacher.set(t.id, []);
    perTeacher.get(t.id)!.push(s);
  }
  const assigned = new Map(assignments.map((a) => [a.slotId, a.teacherId]));
  for (const s of slots)
    if (!assigned.get(s.id)) {
      const eligible = d.teachers.filter(
        (t) => !forbidden(d, t, s, subject).length,
      );
      let reason = "";
      if (!eligible.length) {
        const counts = new Map<string, number>();
        for (const t of d.teachers)
          for (const r of forbidden(d, t, s, subject))
            counts.set(r, (counts.get(r) ?? 0) + 1);
        reason = `가능 후보 없음 (${[...counts].map(([r, n]) => `${r} ${n}명`).join(", ") || "등록된 교사 없음"})`;
      } else
        reason = `가능 후보 ${eligible.length}명 · 동시간 배정 또는 탐색 한도로 미배정. 해결 불가능 판정이 아닙니다.`;
      issues.push({
        severity: "warning",
        code: "unassigned",
        slotId: s.id,
        date: s.date,
        message: `${s.date} ${s.period}교시 ${d.rooms.find((r) => r.id === s.roomId)?.name}: ${reason}`,
      });
    }
  for (const t of d.teachers) {
    const ss = perTeacher.get(t.id) ?? [];
    for (const time of requiredTimes(d, t, slots))
      if (!ss.some((s) => key(s) === key(time)))
        issues.push({
          severity: "warning",
          code: "required",
          teacherId: t.id,
          date: time.date,
          message: `${t.name} · ${time.date} ${time.period}교시 지정배치 미충족`,
        });
    if (isDesignated(t) && !t.availability?.length)
      issues.push({
        severity: "info",
        code: "no-designation",
        teacherId: t.id,
        message: `${t.name}: 지정 교시가 없어 감독에 배정되지 않습니다.`,
      });
    // Designated periods are explicit choices, so count limits do not apply.
    if (d.settings.mode === "mainSub" || isDesignated(t)) continue;
    const warn = (
      code: string,
      label: string,
      actual: number,
      limit: number,
      date?: string,
    ) => {
      if (actual > limit)
        issues.push({
          severity: "warning",
          code,
          teacherId: t.id,
          date,
          actual,
          limit,
          message: `${t.name}${date ? ` · ${date}` : ""}: ${label} ${actual}회 / 제한 ${limit}회`,
        });
    };
    warn(
      "classroom-cap",
      "전체 교실 감독",
      ss.filter((s) => s.kind === "classroom").length,
      d.settings.maxClassroom,
    );
    for (const day of d.dates) {
      const today = ss.filter((s) => s.date === day.date),
        hall = today.filter((s) => s.kind === "hallway").length,
        cls = today.length - hall;
      warn(
        "hallway-cap",
        "일일 복도 감독",
        hall,
        d.settings.maxHallway,
        day.date,
      );
      // Original rule: two classroom periods unless a hallway assignment exists on that day.
      if (!d.settings.allowThird && hall === 0)
        warn("daily-cap", "일일 교실 감독", cls, 2, day.date);
    }
  }
  return issues;
}
export function assertManual(
  d: ExamDocument,
  assignments: Assignment[],
): Issue[] {
  const issues = validate(d, assignments),
    errors = issues.filter((x) => x.severity === "error");
  if (errors.length)
    throw new Error(
      errors
        .slice(0, 4)
        .map((x) => x.message)
        .join("\n"),
    );
  return issues;
}
/** Why a teacher has no duty in a period (shown in timetables and exports); "" if free. */
export function unavailableReason(
  t: Teacher,
  time: { date: string; period: number },
  subjects: Map<string, Set<string>>,
  slots: Slot[],
) {
  if (t.role === "excluded") return "감독 제외";
  const listed = t.availability?.some((x) => key(x) === key(time)) ?? false;
  if (isDesignated(t) && !listed) return "지정 외";
  const ex = t.exclusions.find((x) => key(x) === key(time));
  if (ex) return ex.reason || "불가";
  if (!isDesignated(t) && t.availability !== null && !listed)
    return t.exclusionReason || "불가";
  const exams = t.subjects.filter((s) => subjects.get(key(time))?.has(s.trim()));
  if (exams.length) return `${exams.join("·")} 시험`;
  if (!slots.some((s) => key(s) === key(time))) return "시험 없음";
  return "";
}
