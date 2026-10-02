import { ComciganTimetable, decodeCell, isExamSubject } from "./timetable";
import { ImportSheet } from "./teacherImport";

/** Preserve teacher indices: identical masked names can identify different people. */
export function comciganTeacherSheet(t: ComciganTimetable): ImportSheet {
  if (!Array.isArray(t.teachers))
    throw new Error("컴시간에서 교사 명단을 제공하지 않습니다. 엑셀이나 Google Sheets로 불러와 주세요.");
  const subjects = new Map<number, Set<string>>();
  for (const grid of [t.original, ...(t.weeks ?? []).map((w) => w.daily)]) {
    if (!Array.isArray(grid)) continue;
    for (const grade of grid.slice(1)) {
      if (!Array.isArray(grade)) continue;
      for (const room of grade.slice(1)) {
        if (!Array.isArray(room)) continue;
        for (const day of room.slice(1)) {
          if (!Array.isArray(day)) continue;
          for (const value of day.slice(1)) {
            const cell = decodeCell(value, t.divisor);
            if (!cell) continue;
            const subject = t.subjects?.[cell.subject];
            if (typeof subject !== "string" || !subject.trim() || isExamSubject(subject)) continue;
            const found = subjects.get(cell.teacher) ?? new Set<string>();
            found.add(subject.trim());
            subjects.set(cell.teacher, found);
          }
        }
      }
    }
  }
  const homerooms = new Map<number, string[]>();
  if (Array.isArray(t.homerooms)) t.homerooms.forEach((grade, g) => {
    if (!Array.isArray(grade)) return;
    grade.forEach((teacher, c) => {
      if (typeof teacher !== "number" || !Number.isInteger(teacher) || teacher <= 0 ||
          teacher >= t.teachers.length || !t.teachers[teacher]?.trim()) return;
      homerooms.set(teacher, [...(homerooms.get(teacher) ?? []), `${g + 1}-${c + 1}`]);
    });
  });
  const rows = [["교사명", "담당과목", "메모", "담임 학급"]];
  t.teachers.forEach((name, index) => {
    if (index === 0 || typeof name !== "string" || !name.trim()) return;
    const rooms = homerooms.get(index) ?? [];
    rows.push([
      name.trim(),
      [...(subjects.get(index) ?? [])].join(", "),
      `컴시간 교사 번호 ${index} · 공개 시간표의 과목을 확인해 주세요` +
        (rooms.length > 1 ? ` · 담임학급 중복(${rooms.join(", ")}) 확인 필요` : ""),
      rooms.length === 1 ? rooms[0] : "",
    ]);
  });
  if (rows.length === 1)
    throw new Error("이 학교에서 공개한 교사 명단이 없습니다.");
  return { name: t.school || "컴시간 교사 명단", rows };
}
