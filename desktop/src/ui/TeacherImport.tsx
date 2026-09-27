import { useMemo, useState } from "react";
import { Check, FileSpreadsheet, Link2 } from "lucide-react";
import { desktop } from "../bridge";
import { ExamDocument } from "../domain/model";
import {
  ColumnMap,
  ImportSheet,
  columnLetter,
  detectHeader,
  importFields,
  previewTeachers,
  suggestColumns,
} from "../domain/teacherImport";
import { Edit, Modal } from "./WorkflowShared";

type Field = keyof ColumnMap;

export function TeacherImport({
  d,
  edit,
  onClose,
}: {
  d: ExamDocument;
  edit: Edit;
  onClose: () => void;
}) {
  const [link, setLink] = useState(""),
    [source, setSource] = useState(""),
    [sheets, setSheets] = useState<ImportSheet[]>([]),
    [sheetIndex, setSheetIndex] = useState(0),
    [header, setHeader] = useState(-1);
  const [mapping, setMapping] = useState<ColumnMap>(suggestColumns([])),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<"" | "link" | "file">("");
  const [omitted, setOmitted] = useState<number[]>([]);
  const rows = sheets[sheetIndex]?.rows ?? [];
  const preview = useMemo(
    () => previewTeachers(rows, header, mapping, d),
    [rows, header, mapping, d],
  );
  // Rows without a usable name are skipped instead of blocking the whole import.
  const chosen = preview.filter(
    (r) => !omitted.includes(r.row) && !r.errors.length,
  );
  const countError = preview.filter((r) => r.errors.length).length;
  // Title row is detected, never asked for; columns are chosen on the preview itself.
  const chooseSheet = (list: ImportSheet[], i: number) => {
    const data = list[i]?.rows ?? [];
    const h = detectHeader(data);
    setSheetIndex(i);
    setHeader(h);
    setMapping(suggestColumns(h >= 0 ? data[h] : []));
    setOmitted([]);
  };
  const load = (list: ImportSheet[], from: string) => {
    const recognized = list.findIndex((s) => detectHeader(s.rows) >= 0);
    setSheets(list);
    setSource(from);
    chooseSheet(list, recognized >= 0 ? recognized : 0);
  };
  const run = async (kind: "link" | "file") => {
    setError("");
    setBusy(kind);
    try {
      if (!desktop?.importTeachers)
        throw new Error("명단 가져오기는 데스크톱 앱에서 이용해 주세요.");
      if (kind === "link") {
        if (typeof desktop.importTeachersFromLink !== "function")
          throw new Error(
            "앱이 업데이트되었습니다. 앱을 닫고 다시 실행한 뒤 링크를 불러와 주세요.",
          );
        load(await desktop.importTeachersFromLink(link), "Google Sheets");
      } else {
        const found = await desktop.importTeachers();
        if (found) load(found, "파일");
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setError(text.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy("");
    }
  };
  const columns = Array.from(
    { length: Math.max(0, ...rows.map((r) => r.length)) },
    (_, i) => i,
  ).filter((c) => rows.some((r) => r[c]?.trim()));
  const fieldOf = (c: number) =>
    (Object.keys(mapping) as Field[]).find((f) => mapping[f] === c) ?? "";
  const assign = (c: number, field: Field | "") =>
    setMapping((m) => {
      const next = { ...m };
      for (const f of Object.keys(next) as Field[])
        if (next[f] === c) next[f] = -1;
      if (field) next[field] = c;
      return next;
    });
  const sampleRows = rows.slice(header + 1).filter((r) => r.some(Boolean));
  return (
    <Modal
      wide
      title="교사 명단 가져오기"
      subtitle="Google Sheets 링크나 엑셀 파일에서 교사를 불러와 명단에 추가합니다. 기존 교사는 그대로 둡니다."
      onClose={onClose}
      footer={
        <>
          <span className="import-count">
            {chosen.length}명 선택
            {countError ? ` · 제외 ${countError}행` : ""}
            {chosen.some((r) => r.review.length)
              ? ` · 추가 후 수정 필요 ${chosen.filter((r) => r.review.length).length}명`
              : ""}
          </span>
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            disabled={
              !!busy ||
              mapping.name < 0 ||
              !chosen.length ||
              d.teachers.length + chosen.length > 1000
            }
            onClick={() => {
              edit((x) => x.teachers.push(...chosen.map((r) => r.teacher)));
              onClose();
            }}
          >
            {chosen.length}명 추가
          </button>
        </>
      }
    >
      {!sheets.length ? (
        <div className="import-sources">
          <form
            className="import-source"
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) void run("link");
            }}
          >
            <h3>
              <Link2 size={17} /> Google Sheets 링크
            </h3>
            <div className="link-row">
              <input
                aria-label="Google Sheets 링크"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <button
                type="submit"
                className="primary"
                disabled={!link.trim() || !!busy}
              >
                {busy === "link" ? "불러오는 중…" : "불러오기"}
              </button>
            </div>
            <p>
              시트의 <b>공유 → 링크가 있는 모든 사용자(뷰어)</b>로 설정한 뒤
              주소창의 링크를 붙여넣으세요.
            </p>
          </form>
          <div className="import-source">
            <h3>
              <FileSpreadsheet size={17} /> 엑셀·CSV 파일
            </h3>
            <button disabled={!!busy} onClick={() => void run("file")}>
              {busy === "file" ? "파일 읽는 중…" : "엑셀·CSV 파일 선택"}
            </button>
            <p>.xlsx, .csv, .tsv 파일을 지원합니다.</p>
          </div>
        </div>
      ) : (
        <div className="import-source loaded">
          <Check size={17} className="ok" />
          <h3>{source}에서 불러왔습니다</h3>
          {sheets.length > 1 && (
            <label className="sheet-pick">
              시트
              <select
                aria-label="명단 시트"
                value={sheetIndex}
                onChange={(e) => chooseSheet(sheets, +e.target.value)}
              >
                {sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="link-button"
            onClick={() => {
              setSheets([]);
              setError("");
            }}
          >
            다른 명단 불러오기
          </button>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!!sheets.length && (
        <>
          <div className="import-mapping">
            <h3>열 연결</h3>
            <p>
              각 열 위의 목록에서 그 열에 들어 있는 정보를 고르세요. 제목을 보고
              미리 골라 두었습니다. <b>교사명</b>은 꼭 골라야 합니다.
            </p>
            <div className="workflow-table-scroll mapping-scroll">
              <table className="mapping-table">
                <thead>
                  <tr>
                    {columns.map((c) => {
                      const field = fieldOf(c);
                      return (
                        <th key={c} className={field ? "mapped" : ""}>
                          <select
                            aria-label={`${columnLetter(c)}열 가져올 항목`}
                            value={field}
                            onChange={(e) =>
                              assign(c, e.target.value as Field | "")
                            }
                          >
                            <option value="">가져오지 않음</option>
                            {(Object.keys(importFields) as Field[]).map((f) => (
                              <option key={f} value={f}>
                                {importFields[f]}
                              </option>
                            ))}
                          </select>
                          <span className="column-name">
                            {columnLetter(c)}열
                            {header >= 0 && rows[header][c]
                              ? ` · ${rows[header][c]}`
                              : ""}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.slice(0, 4).map((r, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c} className={fieldOf(c) ? "mapped" : ""}>
                          {r[c]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mapping.name < 0 && (
              <p className="field-error" role="alert">
                교사 이름이 들어 있는 열에서 ‘교사명’을 골라 주세요.
              </p>
            )}
          </div>
          {mapping.name >= 0 && (
            <div className="import-preview">
              <h3>추가할 교사 확인</h3>
              <p>
                제외할 교사는 체크를 해제하세요. 같은 이름도 별도 교사로
                추가됩니다.
              </p>
              {d.teachers.length + chosen.length > 1000 && (
                <p role="alert">
                  전체 교사는 최대 1,000명까지 등록할 수 있습니다.
                </p>
              )}
              <div className="workflow-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>추가</th>
                      <th>교사명</th>
                      <th>담당과목</th>
                      <th>확인 사항</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.row}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${r.row}행 가져오기`}
                            disabled={!!r.errors.length}
                            checked={
                              !r.errors.length && !omitted.includes(r.row)
                            }
                            onChange={(e) =>
                              setOmitted((x) =>
                                e.target.checked
                                  ? x.filter((i) => i !== r.row)
                                  : [...x, r.row],
                              )
                            }
                          />
                        </td>
                        <td>{r.teacher.name || "이름 없음"}</td>
                        <td>{r.teacher.subjects.join(", ")}</td>
                        <td
                          className={
                            r.errors.length
                              ? "field-error"
                              : r.review.length
                                ? "needs-review"
                                : ""
                          }
                        >
                          {r.review.length > 0 && !r.errors.length && (
                            <b>추가 후 수정 필요 · </b>
                          )}
                          {[...r.errors, ...r.review, ...r.warnings].join(
                            " / ",
                          ) || "추가 가능"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
