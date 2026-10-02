import { useState } from "react";
import { ExamDocument } from "../domain/model";
import { Edit, Modal } from "./WorkflowShared";

const parseSubjects = (text: string) => [
  ...new Set(
    text
      .split(/[,，/]/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

/**
 * Spreadsheet-style editor for teacher names and subjects. Masked names
 * ("이주*") can be fixed row by row with the keyboard, or by pasting a column
 * copied from Excel: pasted lines fill the rows below the cursor.
 */
export function BulkTeacherEdit({
  d,
  edit,
  onClose,
}: {
  d: ExamDocument;
  edit: Edit;
  onClose: () => void;
}) {
  const hasMasked = d.teachers.some((t) => t.name.includes("*"));
  const [maskedOnly, setMaskedOnly] = useState(hasMasked);
  const [draft, setDraft] = useState<Record<string, { name: string; subjects: string }>>(
    () =>
      Object.fromEntries(
        d.teachers.map((t) => [t.id, { name: t.name, subjects: t.subjects.join(", ") }]),
      ),
  );
  const rows = d.teachers.filter((t) => !maskedOnly || t.name.includes("*"));
  const changed = d.teachers.filter((t) => {
    const v = draft[t.id];
    return v && (v.name.trim() !== t.name || parseSubjects(v.subjects).join() !== t.subjects.join());
  });
  const empty = changed.some((t) => !draft[t.id].name.trim());
  const set = (id: string, field: "name" | "subjects", value: string) =>
    setDraft((old) => ({ ...old, [id]: { ...old[id], [field]: value } }));
  const focus = (row: number, col: number) => {
    const el = document.querySelector<HTMLInputElement>(`[data-bulk="${row}|${col}"]`);
    el?.focus();
    el?.select();
    return !!el;
  };
  const paste = (e: React.ClipboardEvent, row: number, col: number) => {
    const text = e.clipboardData.getData("text");
    if (!/[\n\t]/.test(text.replace(/[\r\n]+$/, ""))) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n");
    setDraft((old) => {
      const next = { ...old };
      lines.forEach((line, k) => {
        const t = rows[row + k];
        if (!t) return;
        line.split("\t").forEach((cell, j) => {
          const c = col + j;
          if (c > 1) return;
          next[t.id] = { ...next[t.id], [c === 0 ? "name" : "subjects"]: cell.trim() };
        });
      });
      return next;
    });
  };
  return (
    <Modal
      wide
      title="이름·담당과목 일괄 편집"
      subtitle="칸을 직접 고치거나 엑셀에서 복사한 열을 붙여넣으세요. 붙여넣은 줄은 커서가 있는 칸부터 아래로 채워집니다."
      onClose={onClose}
      footer={
        <>
          <span className="import-count">
            {changed.length ? `${changed.length}명 변경` : "변경 없음"}
            {empty ? " · 이름이 빈 칸이 있습니다" : ""}
          </span>
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            disabled={!changed.length || empty}
            onClick={() => {
              edit((x) => {
                for (const c of changed) {
                  const t = x.teachers.find((a) => a.id === c.id);
                  if (!t) continue;
                  t.name = draft[c.id].name.trim();
                  t.subjects = parseSubjects(draft[c.id].subjects);
                }
              });
              onClose();
            }}
          >
            {changed.length}명 적용
          </button>
        </>
      }
    >
      <div className="match-toolbar">
        <label className="check-label">
          <input
            type="checkbox"
            checked={maskedOnly}
            onChange={(e) => setMaskedOnly(e.target.checked)}
          />
          이름이 가려진(*) 교사만 보기
        </label>
        <span>{rows.length}명 표시</span>
      </div>
      <div className="workflow-table-scroll">
        <table className="bulk-teacher-table">
          <thead>
            <tr>
              <th>순번</th>
              <th>교사명</th>
              <th>
                담당과목 <small>쉼표로 구분</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, row) => (
              <tr key={t.id}>
                <td className="row-number">{d.teachers.indexOf(t) + 1}</td>
                {(["name", "subjects"] as const).map((field, col) => (
                  <td key={field}>
                    <input
                      data-bulk={`${row}|${col}`}
                      aria-label={`${t.name} ${field === "name" ? "이름" : "담당과목"}`}
                      value={draft[t.id]?.[field] ?? ""}
                      onChange={(e) => set(t.id, field, e.target.value)}
                      onPaste={(e) => paste(e, row, col)}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === "Enter" || e.key === "ArrowDown") {
                          e.preventDefault();
                          focus(row + 1, col);
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          focus(row - 1, col);
                        }
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
