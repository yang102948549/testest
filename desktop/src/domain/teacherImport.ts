import { ExamDocument, Teacher, teacherSchema, uid } from "./model";
export type ImportSheet = { name: string; rows: string[][] };
export const importFields = {
  name: "교사명",
  subjects: "담당과목",
  homeroom: "담임 학급",
  movingRooms: "감독불가학급",
  role: "역할",
  note: "메모",
};
export type ColumnMap = Record<keyof typeof importFields, number>;
export function parseDelimited(text: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const delimiter = text.split(/\r?\n/)[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === delimiter || c === "\n" || c === "\r")) {
      row.push(cell.trim());
      cell = "";
      if (c !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else cell += c;
  }
  if (quoted)
    throw new Error(
      "따옴표가 닫히지 않은 CSV입니다. 파일을 다시 저장해 주세요.",
    );
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length > 2001 || rows.some((r) => r.length > 100))
    throw new Error("최대 2,000행·100열의 명단 파일을 사용해 주세요.");
  return rows;
}
/** Index of the title row, or -1 when no row looks like one (every row is data). */
export function detectHeader(rows: string[][]) {
  return rows.slice(0, 30).findIndex((r) => suggestColumns(r).name >= 0);
}
export const columnLetter = (i: number): string =>
  (i >= 26 ? columnLetter(Math.floor(i / 26) - 1) : "") +
  String.fromCharCode(65 + (i % 26));
export function suggestColumns(headers: string[]): ColumnMap {
  const aliases = {
    name: ["교사명", "이름", "성명", "교사이름", "name"],
    subjects: ["담당과목", "과목", "교과", "subjects"],
    homeroom: ["담임", "담임학급", "담임반"],
    movingRooms: ["감독불가학급", "감독불가반", "이동학급", "이동반"],
    role: ["역할", "배정역할"],
    note: ["메모", "비고", "제외사유"],
  };
  const clean = (x: string) => x.replace(/\s/g, "").toLowerCase();
  return Object.fromEntries(
    Object.entries(aliases).map(([field, names]) => [
      field,
      headers.findIndex((h) => names.includes(clean(h))),
    ]),
  ) as ColumnMap;
}
const split = (s: string) => [
  ...new Set(
    s
      .split(/[,/;\n]/)
      .map((x) => x.trim())
      .filter(Boolean),
  ),
];
const roleNames: Record<string, Teacher["role"]> = {
  일반: "normal",
  일반교사: "normal",
  지정배치: "designated",
  필수배치: "designated",
  시간강사: "lecturer",
  "시간강사·비교과": "lecturer",
  비교과: "support",
  순회: "roaming",
  순회교사: "roaming",
  복도전담: "hallway",
  복도배치: "hallway",
  감독제외: "excluded",
  완전제외: "excluded",
};
export function previewTeachers(
  rows: string[][],
  headerRow: number,
  map: ColumnMap,
  d: ExamDocument,
) {
  return rows.slice(headerRow + 1).flatMap((row, i) => {
    if (!row.some((v) => v.trim())) return [];
    const value = (field: keyof ColumnMap) => (row[map[field]] ?? "").trim();
    const errors: string[] = [];
    const warnings: string[] = [];
    // Unknown classes and roles do not block the import; they become review notes.
    const review: string[] = [];
    const room = (name: string, label: string) => {
      if (!name || name === "없음" || name === "-") return null;
      const normalize = (s: string) =>
        s.replace(/(\d+)학년\s*(\d+)반/, "$1-$2").replace(/\s/g, "");
      const found = d.rooms.filter(
        (r) => r.kind === "classroom" && normalize(r.name) === normalize(name),
      );
      if (found.length !== 1) {
        review.push(`${label} '${name}'이 고사실에 없습니다`);
        return null;
      }
      return found[0].id;
    };
    const rawRole = value("role").replace(/\s/g, "");
    const role = rawRole ? roleNames[rawRole] : "normal";
    if (!role) review.push(`역할 '${value("role")}'을 알 수 없어 일반 교사로 두었습니다`);
    const teacher: Teacher = {
      id: uid(),
      name: value("name"),
      subjects: split(value("subjects")),
      homeroom: room(value("homeroom"), "담임 학급"),
      movingRooms: split(value("movingRooms"))
        .map((n) => room(n, "감독불가학급"))
        .filter((x): x is string => !!x),
      role: role ?? "normal",
      note: value("note"),
      availability: null,
      exclusions: [],
      ...(review.length ? { review } : {}),
    };
    if (!teacher.name) errors.push("교사명이 비어 있습니다");
    const parsed = teacherSchema.safeParse(teacher);
    if (!parsed.success)
      errors.push(
        ...parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`),
      );
    if (d.teachers.some((t) => t.name === teacher.name))
      warnings.push(
        "기존 명단에 같은 이름이 있습니다. 추가하면 별도 교사로 등록됩니다.",
      );
    if (
      rows
        .slice(headerRow + 1)
        .filter((r) => (r[map.name] ?? "").trim() === teacher.name).length > 1
    )
      warnings.push("파일 안에 동명이인이 있습니다.");
    return [{ row: i + headerRow + 2, teacher, errors, warnings, review }];
  });
}
