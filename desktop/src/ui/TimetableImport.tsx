import { useEffect, useRef, useState } from "react";
import { CalendarSearch, FileSpreadsheet } from "lucide-react";
import { desktop } from "../bridge";
import { ExamDocument, uid } from "../domain/model";
import { isDesignated } from "../domain/rules";
import {
  ComciganSchool,
  DateSource,
  TeacherMatch,
  TimetableLesson,
  applyTimetable,
  comciganLessons,
  excelLessons,
  isExamSubject,
  matchTeachers,
} from "../domain/timetable";
import { SchoolSearch, cleanError, rememberSchool } from "./SchoolSearch";
import { Edit, Modal, formatDay } from "./WorkflowShared";

type Filter = "all" | "review" | "linked";

/**
 * Timetable → proctoring periods. "blocked": normal teachers cannot proctor
 * while they teach. "designated": special teachers proctor the periods they teach.
 */
export function TimetableImport({
  d,
  edit,
  notify,
  mode,
  onClose,
}: {
  d: ExamDocument;
  edit: Edit;
  notify: (s: string) => void;
  mode: "blocked" | "designated";
  onClose: () => void;
}) {
  const designatedMode = mode === "designated";
  const inScope = (t: ExamDocument["teachers"][number]) =>
    designatedMode ? isDesignated(t) : true;
  const [tab, setTab] = useState<"comcigan" | "excel">("comcigan"),
    [school, setSchool] = useState<ComciganSchool | null>(d.school ?? null),
    [otherSchool, setOtherSchool] = useState(!d.school),
    [filter, setFilter] = useState<Filter>(designatedMode ? "linked" : "all"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState<{
      from: string;
      lessons: TimetableLesson[];
      sources: DateSource[];
    } | null>(null),
    [matches, setMatches] = useState<TeacherMatch[]>([]),
    // Rows the user wants to apply; matched rows start selected.
    [picked, setPicked] = useState<Set<string>>(new Set());
  const run = async (label: string, fn: () => Promise<void>) => {
    setError("");
    setBusy(label);
    try {
      if (!desktop?.fetchComcigan)
        throw new Error("앱이 업데이트되었습니다. 앱을 닫고 다시 실행해 주세요.");
      await fn();
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy("");
    }
  };
  const use = (
    from: string,
    result: { lessons: TimetableLesson[]; sources: DateSource[] },
  ) => {
    const lessons = result.lessons.filter((l) => !isExamSubject(l.subject));
    setLoaded({ from, lessons, sources: result.sources });
    const found = matchTeachers(lessons, d.teachers, inScope);
    setMatches(found);
    setPicked(new Set(found.filter((m) => m.teacherId).map((m) => m.key)));
    // Special teachers are few; show everything when none of them matched.
    if (designatedMode) setFilter(found.some((m) => m.teacherId) ? "linked" : "all");
  };
  const pick = (s: ComciganSchool) =>
    run("fetch", async () => {
      const t = await desktop!.fetchComcigan(s.code);
      rememberSchool(s);
      setSchool(s);
      use(`컴시간 · ${s.name}`, comciganLessons(t, d.dates));
    });
  // A school set in the exam settings loads right away.
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || !d.school) return;
    auto.current = true;
    void pick(d.school);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openFiles = () =>
    run("files", async () => {
      const sheets = await desktop!.importTimetableFiles();
      if (!sheets) return;
      const result = excelLessons(sheets, d.dates);
      if (!result.lessons.length)
        throw new Error(
          "시간표에서 요일(월·화… 또는 월(19))이 적힌 제목 행과 교시 행을 찾지 못했습니다.",
        );
      use("엑셀 시간표", result);
    });
  const roster = d.teachers.filter((t) => t.role !== "excluded" && inScope(t));
  const chosen = matches.filter((m) => m.teacherId && picked.has(m.key));
  // Same masked name for different teachers: tell the rows apart by subject.
  const nameOf = (m: TeacherMatch) =>
    matches.filter((x) => x.label === m.label).length > 1
      ? `${m.label} (${m.subjects.join("·") || "과목 없음"})`
      : m.label;
  const pickable = matches.filter((m) => m.teacherId);
  const applicable = chosen.filter((m) => {
    const t = d.teachers.find((a) => a.id === m.teacherId);
    return t && (designatedMode ? isDesignated(t) : t.role === "normal");
  });
  const unlinked = matches.filter((m) => !m.teacherId);
  const shown = matches
    .map((m, i) => ({ m, i }))
    .filter(({ m }) =>
      filter === "all" ? true : filter === "linked" ? !!m.teacherId : !m.teacherId,
    );
  // Timetable teachers missing from the roster become new teachers, masked name included.
  const addAsNew = (rows: TeacherMatch[]) => {
    const ids = new Map(rows.map((m) => [m.key, uid()]));
    edit((x) => {
      for (const m of rows)
        x.teachers.push({
          id: ids.get(m.key)!,
          name: m.label,
          subjects: m.subjects,
          homeroom: null,
          movingRooms: [],
          role: designatedMode ? "designated" : "normal",
          note: "시간표에서 추가",
          availability: designatedMode ? [] : null,
          exclusions: [],
        });
    });
    setMatches((list) =>
      list.map((m) => (ids.has(m.key) ? { ...m, teacherId: ids.get(m.key)! } : m)),
    );
    setPicked((old) => new Set([...old, ...ids.keys()]));
  };
  const excel = loaded?.from === "엑셀 시간표";
  const sourceLabel = {
    week: excel ? "날짜 일치" : "그 주 실제 시간표",
    base: excel ? "요일 기준" : "기본 시간표(요일 기준)",
    none: "수업 정보 없음",
  } as const;
  const filters: [Filter, string][] = [
    ["all", `전체 ${matches.length}`],
    ["review", `연결 필요 ${unlinked.length}`],
    ["linked", `연결됨 ${pickable.length}`],
  ];
  return (
    <Modal
      wide
      title="시간표에서 불러오기"
      subtitle={
        designatedMode
          ? "시험 시간에 수업이 있는 특별교사의 교시를 감독 가능으로 체크합니다. 기존 체크는 그대로 두고 더하기만 합니다."
          : "시험 시간에 수업이 있는 일반 교사를 감독불가로 체크합니다. 기존 체크는 그대로 두고 더하기만 합니다."
      }
      onClose={onClose}
      footer={
        <>
          <span className="import-count">
            {loaded
              ? `선택 ${chosen.length} / ${matches.length}명`
              : "시간표를 불러오세요"}
          </span>
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            disabled={!applicable.length || !!busy}
            onClick={() => {
              let result = { changed: 0, skipped: [] as string[] };
              edit((x) => {
                result = applyTimetable(x, chosen, mode);
              });
              notify(
                (designatedMode
                  ? `${result.changed}명에게 수업 교시를 감독 가능으로 체크했습니다.`
                  : `${result.changed}명에게 수업 교시를 감독불가로 체크했습니다.`) +
                  (result.skipped.length
                    ? designatedMode
                      ? ` 일반 교사 ${result.skipped.length}명(${result.skipped.join(", ")})은 제외했습니다.`
                      : ` 특별교사 ${result.skipped.length}명(${result.skipped.join(", ")})은 지정 교시를 직접 확인해 주세요.`
                    : "") +
                  " 확인 후 저장하세요.",
              );
              onClose();
            }}
          >
            {applicable.length}명 적용
          </button>
        </>
      }
    >
      <div className="workflow-tabs timetable-tabs">
        <button
          className={tab === "comcigan" ? "active" : ""}
          onClick={() => setTab("comcigan")}
        >
          컴시간알리미
        </button>
        <button
          className={tab === "excel" ? "active" : ""}
          onClick={() => setTab("excel")}
        >
          엑셀 시간표
        </button>
      </div>
      {tab === "comcigan" ? (
        <div className="import-source">
          <h3>
            <CalendarSearch size={17} /> 컴시간 학교
          </h3>
          {d.school && !otherSchool ? (
            <div className="school-current">
              <div>
                <b>{d.school.name}</b>
                <small>{d.school.region} · 시험 설정의 학교</small>
              </div>
              <div className="actions">
                <button disabled={!!busy} onClick={() => void pick(d.school!)}>
                  {busy === "fetch" ? "받는 중…" : "다시 불러오기"}
                </button>
                <button onClick={() => setOtherSchool(true)}>
                  다른 학교 검색
                </button>
              </div>
            </div>
          ) : (
            <SchoolSearch
              selected={school?.code}
              disabled={!!busy}
              onPick={(s) => void pick(s)}
            />
          )}
          <p>
            컴시간은 이번 주와 다음 주 시간표만 제공합니다. 그 밖의 시험일은
            기본 시간표를 요일에 맞춰 씁니다. 학교를 설정하지 않아도 여기서
            검색하거나 엑셀 시간표로 불러올 수 있습니다.
            {busy === "fetch" && " 시간표를 받는 중…"}
          </p>
        </div>
      ) : (
        <div className="import-source">
          <h3>
            <FileSpreadsheet size={17} /> 엑셀 시간표 파일
          </h3>
          <button disabled={!!busy} onClick={() => void openFiles()}>
            {busy === "files" ? "파일 읽는 중…" : "시간표 파일 선택 (여러 개 가능)"}
          </button>
          <p>
            제목 행에 요일(월·화… 또는 날짜가 있는 월(19)), 첫 열에 교시,
            칸에는 “과목 교사명”이 있는 학년별 시간표를 지원합니다.
          </p>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {loaded && (
        <>
          <div className="timetable-sources">
            <span>{loaded.from}</span>
            {loaded.sources.map((s) => (
              <span key={s.date} className={`source-${s.source}`}>
                {formatDay(s.date)} · {sourceLabel[s.source]}
              </span>
            ))}
          </div>
          <div className="import-preview">
            <h3>교사 연결</h3>
            <p>
              시험 시간 수업 {loaded.lessons.length}건을 찾았습니다. 적용할
              교사만 체크하세요. 이름이 가려져 여러 교사가 해당되면 연결할
              교사를 고르세요. ‘고사·시험’은 수업이 아니므로 제외했습니다.
            </p>
            <div className="match-toolbar">
              <div className="workflow-tabs">
                {filters.map(([id, label]) => (
                  <button
                    key={id}
                    className={filter === id ? "active" : ""}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {!!unlinked.length && !designatedMode && (
                <button
                  title="명단에 없는 교사를 시간표의 이름(가려진 이름 포함) 그대로 새 일반 교사로 추가합니다. 이름은 교사 명단에서 고칠 수 있습니다."
                  onClick={() => addAsNew(unlinked.filter((m) => !m.candidates.length))}
                  disabled={!unlinked.some((m) => !m.candidates.length)}
                >
                  명단에 없는 {unlinked.filter((m) => !m.candidates.length).length}명 새 교사로 추가
                </button>
              )}
            </div>
            <div className="workflow-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="연결된 교사 모두 선택"
                        checked={
                          !!pickable.length &&
                          pickable.every((m) => picked.has(m.key))
                        }
                        onChange={(e) =>
                          setPicked(
                            new Set(
                              e.target.checked
                                ? pickable.map((m) => m.key)
                                : [],
                            ),
                          )
                        }
                      />
                    </th>
                    <th>시간표 표기</th>
                    <th>과목</th>
                    <th>시험 시간 수업</th>
                    <th>연결할 교사</th>
                  </tr>
                </thead>
                <tbody>
                  {!shown.length && (
                    <tr>
                      <td colSpan={5} className="muted-cell">
                        {filter === "linked"
                          ? "명단과 연결된 교사가 없습니다. ‘전체’에서 직접 연결하세요."
                          : "해당하는 교사가 없습니다."}
                      </td>
                    </tr>
                  )}
                  {shown.map(({ m, i }) => {
                    const others = roster.filter(
                      (t) => !m.candidates.includes(t),
                    );
                    return (
                      <tr
                        key={m.key}
                        className={picked.has(m.key) ? "" : "row-off"}
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${nameOf(m)} 적용`}
                            disabled={!m.teacherId}
                            checked={!!m.teacherId && picked.has(m.key)}
                            onChange={(e) =>
                              setPicked((old) => {
                                const next = new Set(old);
                                if (e.target.checked) next.add(m.key);
                                else next.delete(m.key);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td>
                          <b>{m.label}</b>
                        </td>
                        <td>{m.subjects.join(", ")}</td>
                        <td>{m.times.length}교시</td>
                        <td
                          className={
                            m.teacherId
                              ? ""
                              : m.candidates.length
                                ? "needs-review"
                                : "muted-cell"
                          }
                        >
                          <div className="match-select">
                            <select
                              aria-label={`${nameOf(m)} 연결할 교사`}
                              value={m.teacherId}
                              onChange={(e) => {
                                const id = e.target.value;
                                setMatches((list) =>
                                  list.map((x, k) =>
                                    k === i ? { ...x, teacherId: id } : x,
                                  ),
                                );
                                // Choosing a teacher selects the row; clearing it deselects.
                                setPicked((old) => {
                                  const next = new Set(old);
                                  if (id) next.add(m.key);
                                  else next.delete(m.key);
                                  return next;
                                });
                              }}
                            >
                              <option value="">
                                {m.candidates.length > 1
                                  ? `후보 ${m.candidates.length}명 · 선택`
                                  : m.candidates.length
                                    ? "연결 안 함"
                                    : "명단에 없음 · 연결 안 함"}
                              </option>
                              {m.candidates.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                  {t.subjects.length
                                    ? ` (${t.subjects.join("·")})`
                                    : ""}
                                </option>
                              ))}
                              {!!others.length && (
                                <optgroup label="다른 교사">
                                  {others.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                      {t.subjects.length
                                        ? ` (${t.subjects.join("·")})`
                                        : ""}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                            {!designatedMode && !m.teacherId && !m.candidates.length && (
                              <button
                                title="시간표의 이름 그대로 새 교사로 추가"
                                onClick={() => addAsNew([m])}
                              >
                                새 교사로 추가
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
