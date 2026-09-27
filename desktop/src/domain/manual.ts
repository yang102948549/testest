import { Assignment, ExamDocument, key } from "./model";
import { forbidden, slotsFor, subjectMap } from "./rules";
export type TeacherCell = { teacherId: string; date: string; period: number };
// Original teacher-table exchange: only two teachers in the SAME period.
// An empty teacher cell is a valid destination, so one assignment can move.
export function previewTeacherSwap(
  d: ExamDocument,
  assignments: Assignment[],
  a: TeacherCell,
  b: TeacherCell,
): { assignments: Assignment[]; reasons: string[] } {
  const reasons: string[] = [];
  if (key(a) !== key(b))
    reasons.push("교환은 같은 날짜, 같은 교시에서만 가능합니다.");
  if (a.teacherId === b.teacherId)
    reasons.push("서로 다른 두 교사를 선택해 주세요.");
  const slots = slotsFor(d),
    bySlot = new Map(slots.map((s) => [s.id, s])),
    subjects = subjectMap(d);
  const aa = assignments.find(
    (x) =>
      x.teacherId === a.teacherId &&
      bySlot.has(x.slotId) &&
      key(bySlot.get(x.slotId)!) === key(a),
  );
  const bb = assignments.find(
    (x) =>
      x.teacherId === b.teacherId &&
      bySlot.has(x.slotId) &&
      key(bySlot.get(x.slotId)!) === key(b),
  );
  if (!aa && !bb)
    reasons.push("두 교사 모두 이 교시에 배정된 감독이 없습니다.");
  for (const [source, destination] of [
    [aa, b.teacherId],
    [bb, a.teacherId],
  ] as const) {
    if (!source) continue;
    const teacher = d.teachers.find((t) => t.id === destination),
      slot = bySlot.get(source.slotId)!;
    if (!teacher) {
      reasons.push("교사 정보를 찾을 수 없습니다.");
      continue;
    }
    reasons.push(
      ...forbidden(d, teacher, slot, subjects).map(
        (r) => `${teacher.name}: ${r}`,
      ),
    );
  }
  const next = assignments.map((x) =>
    x === aa
      ? { ...x, teacherId: b.teacherId }
      : x === bb
        ? { ...x, teacherId: a.teacherId }
        : x,
  );
  return { assignments: next, reasons };
}
