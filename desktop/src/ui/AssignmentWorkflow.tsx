// ProctorSwapTableUI*.html: teacher-first two-click swaps, inline conflict
// highlighting, room-cell candidate dialog and explicit "변경사항 반영".
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  RefreshCw,
  Undo2,
  X,
  AlertTriangle,
} from "lucide-react";
import {
  Assignment,
  ExamDocument,
  Issue,
  Teacher,
  fingerprint,
  key,
} from "../domain/model";
import {
  assertManual,
  forbidden,
  isDesignated,
  slotsFor,
  sortedRooms,
  unavailableReason,
  subjectMap,
  validate,
  weight,
} from "../domain/rules";
import { previewTeacherSwap, TeacherCell } from "../domain/manual";
import {
  Edit,
  Empty,
  Modal,
  Panel,
  SearchBox,
  formatDay,
  kinds,
  labelTeacher,
} from "./WorkflowShared";
export function Assignments({
  d,
  edit,
  stale,
  running,
  progress,
  notify,
  draft,
  setDraft,
}: {
  d: ExamDocument;
  edit: Edit;
  stale: boolean;
  running: boolean;
  progress: number;
  notify: (s: string) => void;
  draft: Assignment[] | null;
  setDraft: (a: Assignment[] | null) => void;
}) {
  const [view, setView] = useState<"teacher" | "room">("teacher"),
    [filter, setFilter] = useState(""),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<TeacherCell[]>([]),
    [candidateSlot, setCandidateSlot] = useState<string | null>(null),
    [candidate, setCandidate] = useState(""),
    [candidateQuery, setCandidateQuery] = useState(""),
    [undo, setUndo] = useState<Assignment[][]>([]),
    [swapped, setSwapped] = useState(""),
    [showIssues, setShowIssues] = useState(false);
  const slots = useMemo(() => slotsFor(d), [d]),
    subjects = useMemo(() => subjectMap(d), [d]);
  const plan = draft ?? d.result?.assignments ?? [];
  const assigned = useMemo(
    () => new Map(plan.map((a) => [a.slotId, a.teacherId])),
    [plan],
  );
  const byTimeTeacher = useMemo(() => {
    const map = new Map<string, typeof slots>();
    for (const s of slots) {
      const t = assigned.get(s.id);
      if (t) {
        const k = t + "/" + key(s);
        map.set(k, [...(map.get(k) ?? []), s]);
      }
    }
    return map;
  }, [slots, assigned]);
  const issues = useMemo(() => (d.result ? validate(d, plan) : []), [d, plan]);
  const dates = d.dates.filter((x) => !filter || x.date === filter),
    times = dates.flatMap((day) =>
      Array.from({ length: day.periods }, (_, i) => ({
        date: day.date,
        period: i + 1,
      })),
    );
  const unavailable = (t: Teacher, time: { date: string; period: number }) =>
    unavailableReason(t, time, subjects, slots);
  const preview =
    selected.length === 2
      ? previewTeacherSwap(d, plan, selected[0], selected[1])
      : null;
  const alternatives = useMemo(() => {
    const result = new Map<string, string[]>();
    if (selected.length === 1) {
      for (const t of d.teachers)
        result.set(
          t.id,
          previewTeacherSwap(d, plan, selected[0], {
            ...selected[0],
            teacherId: t.id,
          }).reasons,
        );
    }
    return result;
  }, [d, plan, selected]);
  useEffect(() => {
    setSelected([]);
    setUndo([]);
  }, [d.id, d.result]);
  const stage = (next: Assignment[]) => {
    try {
      assertManual(d, next);
      setUndo((old) => [...old.slice(-19), plan]);
      setDraft(next);
      setSelected([]);
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  const apply = () => {
    try {
      const found = assertManual(d, plan);
      edit((x) => {
        x.result = {
          ...x.result!,
          assignments: plan,
          issues: found,
          fingerprint: fingerprint(x),
        };
      }, { persist: true });
      setDraft(null);
      setUndo([]);
      setSwapped("");
      notify("조정한 배정을 반영하고 저장했습니다.");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  };
  const revalidate = () => {
    const busy = new Set<string>();
    let removed = 0;
    const next = slots.map((s) => {
      let id = assigned.get(s.id) ?? null;
      const t = d.teachers.find((t) => t.id === id);
      if (
        id &&
        (!t ||
          forbidden(d, t, s, subjects).length ||
          busy.has(id + "/" + key(s)))
      ) {
        id = null;
        removed++;
      }
      if (id) busy.add(id + "/" + key(s));
      return { slotId: s.id, teacherId: id };
    });
    edit((x) => {
      x.result = {
        ...x.result!,
        assignments: next,
        issues: validate(x, next),
        fingerprint: fingerprint(x),
      };
    }, { persist: true });
    setDraft(null);
    notify(`재검증했습니다. 금지·중복 배정 ${removed}건을 해제했습니다.`);
  };
  const clickTeacher = (cell: TeacherCell) => {
    if (stale || running) return;
    const same = (x: TeacherCell) =>
      x.teacherId === cell.teacherId && key(x) === key(cell);
    setSwapped("");
    if (selected.some(same)) {
      setSelected([]);
      return;
    }
    // A cell in another period (or after a refused pair) starts a new selection.
    if (selected.length !== 1 || key(selected[0]) !== key(cell)) {
      setSelected([cell]);
      return;
    }
    const first = selected[0];
    const result = previewTeacherSwap(d, plan, first, cell);
    if (result.reasons.length) {
      setSelected([first, cell]);
      return;
    }
    if (stage(result.assignments)) {
      const name = (id: string | null) =>
        d.teachers.find((t) => t.id === id)?.name ?? "빈칸";
      setSwapped(
        `${name(first.teacherId)} ↔ ${name(cell.teacherId)} 교환했습니다.`,
      );
    }
  };
  const activeSlot = slots.find((s) => s.id === candidateSlot);
  const candidates = activeSlot
    ? d.teachers
        .map((t) => {
          const reasons = forbidden(d, t, activeSlot, subjects);
          if (
            (byTimeTeacher.get(t.id + "/" + key(activeSlot)) ?? []).some(
              (s) => s.id !== activeSlot.id,
            )
          )
            reasons.push("동시간 다른 고사실 배정");
          return { teacher: t, reasons };
        })
        .filter((x) => x.teacher.name.includes(candidateQuery))
        .sort(
          (a, b) =>
            Number(!!a.reasons.length) - Number(!!b.reasons.length) ||
            a.teacher.name.localeCompare(b.teacher.name),
        )
    : [];
  const openCandidate = (id: string) => {
    if (stale || running) return;
    setCandidateSlot(id);
    setCandidate(assigned.get(id) ?? "");
    setCandidateQuery("");
  };
  const needCheck = issues.filter(
    (i) =>
      i.severity === "error" ||
      i.code === "unassigned" ||
      i.code === "required" ||
      i.code.endsWith("-cap"),
  );
  return (
    <div className="original-workflow assignment-workflow">
      {running && (
        <div className="progress-box">
          감독 배정 계산 중 · {progress}%<progress value={progress} max={100} />
        </div>
      )}
      {stale && (
        <div className="warning-box">
          <AlertTriangle size={19} />
          <span>
            기초 설정이 바뀌었습니다. 먼저 재검증하거나 다시 배정하세요.
          </span>
          <button onClick={revalidate} disabled={running}>
            <RefreshCw size={16} />
            재검증
          </button>
        </div>
      )}
      {!d.result ? (
        <Empty>기초 설정을 마친 뒤 ‘자동 배정’을 실행해 주세요.</Empty>
      ) : (
        <>
          <div className="assignment-summary">
            <span>
              <b>{slots.filter((s) => assigned.get(s.id)).length}</b> /{" "}
              {slots.length}자리 배정
            </span>
            <span
              className={
                issues.some((i) => i.code === "unassigned") ? "attention" : ""
              }
            >
              미배정{" "}
              <b>{issues.filter((i) => i.code === "unassigned").length}</b>
            </span>
            <span>
              횟수 초과{" "}
              <b>{issues.filter((i) => i.code.endsWith("-cap")).length}</b>
            </span>
            <span>
              지정배치 미충족{" "}
              <b>{issues.filter((i) => i.code === "required").length}</b>
            </span>
            <button onClick={() => setShowIssues((v) => !v)}>
              {showIssues ? "검증 내역 접기" : "검증 내역 보기"}
            </button>
          </div>
          <Panel
            title="감독 배정 조정"
            action={
              <div className="workflow-tabs">
                <button
                  className={view === "teacher" ? "active" : ""}
                  onClick={() => {
                    setView("teacher");
                    setSelected([]);
                  }}
                >
                  교사별 보기 · 맞교환
                </button>
                <button
                  className={view === "room" ? "active" : ""}
                  onClick={() => {
                    setView("room");
                    setSelected([]);
                  }}
                >
                  고사실별 보기 · 미배정 확인
                </button>
              </div>
            }
          >
            <div
              className={`selection-guide ${preview?.reasons.length ? "conflict-guide" : ""}`}
              role="status"
            >
              {preview ? (
                preview.reasons.length ? (
                  <>
                    <AlertTriangle size={20} />
                    <span>{preview.reasons.join(" / ")}</span>
                  </>
                ) : null
              ) : selected.length ? (
                <>
                  <ArrowLeftRight size={20} />
                  <span>
                    <b>
                      {
                        d.teachers.find((t) => t.id === selected[0].teacherId)
                          ?.name
                      }
                    </b>{" "}
                    · {formatDay(selected[0].date)} {selected[0].period}교시
                    선택됨. 같은 열에서 바꿀 교사를 누르면 바로 교환됩니다.
                  </span>
                </>
              ) : swapped ? (
                <>
                  <Check size={20} />
                  <span>
                    {swapped} 확정하려면 ‘변경사항 반영’을 누르세요.
                  </span>
                </>
              ) : (
                <span>
                  {view === "teacher"
                    ? "같은 교시의 두 칸을 차례로 누르면 바로 교환됩니다. 빈칸을 고르면 감독을 다른 교사에게 옮깁니다. 선택한 칸을 다시 누르면 해제됩니다."
                    : "고사실 칸을 클릭하면 배정 가능한 교사와 불가 사유를 확인할 수 있습니다."}
                </span>
              )}
            </div>
            {draft && (
              <div className="assignment-controls">
                <span className="pending-label">
                  반영 전 변경{" "}
                  {
                    draft.filter(
                      (a) =>
                        d.result!.assignments.find((x) => x.slotId === a.slotId)
                          ?.teacherId !== a.teacherId,
                    ).length
                  }
                  자리
                </span>
                <button
                  className="ghost"
                  disabled={!undo.length || stale || running}
                  onClick={() => {
                    setDraft(undo.at(-1)!);
                    setUndo((h) => h.slice(0, -1));
                    setSelected([]);
                    setSwapped("");
                  }}
                >
                  <Undo2 size={15} />
                  되돌리기
                </button>
                <button
                  className="ghost"
                  onClick={() => {
                    setDraft(null);
                    setUndo([]);
                    setSelected([]);
                    setSwapped("");
                  }}
                >
                  모두 취소
                </button>
                <button
                  className="primary"
                  disabled={stale || running}
                  onClick={apply}
                >
                  변경사항 반영
                </button>
              </div>
            )}
            <div className="workflow-filter">
              <SearchBox
                value={query}
                onChange={setQuery}
                label={view === "teacher" ? "교사명 검색" : "고사실 검색"}
              />
              <select
                aria-label="배정 날짜 필터"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setSelected([]);
                }}
              >
                <option value="">전체 날짜</option>
                {d.dates.map((day) => (
                  <option key={day.date} value={day.date}>
                    {formatDay(day.date)}
                  </option>
                ))}
              </select>
            </div>
            <div className="workflow-table-scroll proctor-scroll">
              <table
                className={`proctor-matrix ${view === "teacher" ? "teacher-view" : "room-view"}`}
              >
                <thead>
                  <tr>
                    {view === "teacher" ? (
                      <>
                        <th rowSpan={2} className="sticky-sequence">
                          순
                        </th>
                        <th rowSpan={2} className="sticky-name">
                          교사명
                        </th>
                        <th rowSpan={2} className="sticky-score date-end">
                          배정
                          <br />
                          점수
                        </th>
                      </>
                    ) : (
                      <th rowSpan={3} className="sticky-name">
                        고사실
                      </th>
                    )}
                    {dates.map((day, i) => (
                      <th
                        colSpan={
                          day.periods *
                          (view === "room" && d.settings.mode === "mainSub"
                            ? 2
                            : 1)
                        }
                        className={`day-color-${i % 3} date-end`}
                        key={day.date}
                      >
                        {formatDay(day.date)}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {times.map((time) => (
                      <th
                        colSpan={
                          view === "room" && d.settings.mode === "mainSub"
                            ? 2
                            : 1
                        }
                        key={key(time)}
                        className={`${time.period === dates.find((x) => x.date === time.date)!.periods ? "date-end" : ""} day-color-${dates.findIndex((x) => x.date === time.date) % 3}`}
                      >
                        {time.period}교시
                      </th>
                    ))}
                  </tr>
                  {view === "room" && (
                    <tr>
                      {times.flatMap((time) =>
                        (d.settings.mode === "mainSub"
                          ? ["정", "부"]
                          : ["감독"]
                        ).map((name, i, arr) => (
                          <th
                            key={key(time) + name}
                            className={
                              i === arr.length - 1 &&
                              time.period ===
                                dates.find((x) => x.date === time.date)!.periods
                                ? "date-end"
                                : ""
                            }
                          >
                            {name}
                          </th>
                        )),
                      )}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {view === "teacher"
                    ? d.teachers
                        .filter((t) => t.name.includes(query))
                        .map((t) => {
                          const own = slots.filter(
                            (s) => assigned.get(s.id) === t.id,
                          );
                          return (
                            <tr
                              key={t.id}
                              className={
                                selected.some((c) => c.teacherId === t.id)
                                  ? "selected-teacher-row"
                                  : ""
                              }
                            >
                              <td className="sticky-sequence">
                                {d.teachers.indexOf(t) + 1}
                              </td>
                              <th className="sticky-name">
                                {labelTeacher(d, t)}
                              </th>
                              <td className="sticky-score date-end">
                                {own.reduce((sum, s) => sum + weight(d, s), 0)}
                                <small>{own.length}회</small>
                              </td>
                              {times.map((time) => {
                                const ownHere =
                                    byTimeTeacher.get(t.id + "/" + key(time)) ??
                                    [],
                                  reason = unavailable(t, time),
                                  isSelected = selected.some(
                                    (c) =>
                                      c.teacherId === t.id &&
                                      key(c) === key(time),
                                  ),
                                  isTarget =
                                    selected.length === 1 &&
                                    key(selected[0]) === key(time) &&
                                    selected[0].teacherId !== t.id,
                                  conflicts = alternatives.get(t.id) ?? [];
                                const className = `${time.period === dates.find((x) => x.date === time.date)!.periods ? "date-end" : ""} ${isSelected ? "selected-swap" : isTarget ? (conflicts.length ? "conflict-swap" : "possible-swap") : reason ? "unavailable-slot" : !ownHere.length ? "empty-slot" : ""}`;
                                return (
                                  <td key={key(time)} className={className}>
                                    <button
                                      className="teacher-slot"
                                      aria-label={`${t.name} ${time.date} ${time.period}교시 감독 선택`}
                                      disabled={stale || running || !!reason}
                                      aria-pressed={isSelected}
                                      title={
                                        isTarget
                                          ? conflicts.length
                                            ? conflicts.join(" / ")
                                            : "교환 가능"
                                          : reason || "클릭하여 교환 선택"
                                      }
                                      onClick={() =>
                                        clickTeacher({
                                          teacherId: t.id,
                                          ...time,
                                        })
                                      }
                                    >
                                      {ownHere.length ? (
                                        ownHere.map((s) => (
                                          <span key={s.id}>
                                            {
                                              d.rooms.find(
                                                (r) => r.id === s.roomId,
                                              )?.name
                                            }
                                            {d.settings.mode === "mainSub" && (
                                              <small
                                                className={`role-badge ${s.kind}`}
                                              >
                                                {kinds[s.kind]}
                                              </small>
                                            )}
                                          </span>
                                        ))
                                      ) : reason ? (
                                        <span className="unavailable-reason">
                                          {reason}
                                        </span>
                                      ) : (
                                        <span className="available-empty">
                                          —
                                        </span>
                                      )}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })
                    : sortedRooms(d.rooms)
                        .filter(
                          (r) =>
                            r.name.includes(query) &&
                            slots.some((s) => s.roomId === r.id),
                        )
                        .map((r) => (
                          <tr key={r.id}>
                            <th className="sticky-name">{r.name}</th>
                            {times.flatMap((time) =>
                              (d.settings.mode === "mainSub"
                                ? ["main", "sub"]
                                : ["general"]
                              ).map((kind, i, arr) => {
                                const s = slots.find(
                                    (s) =>
                                      s.roomId === r.id &&
                                      key(s) === key(time) &&
                                      (kind === "general" || s.kind === kind),
                                  ),
                                  t = d.teachers.find(
                                    (t) =>
                                      t.id === (s ? assigned.get(s.id) : null),
                                  );
                                return (
                                  <td
                                    key={key(time) + kind}
                                    className={`${i === arr.length - 1 && time.period === dates.find((x) => x.date === time.date)!.periods ? "date-end" : ""} ${!s ? "inactive" : !t ? "unassigned-slot" : ""}`}
                                  >
                                    {s ? (
                                      <button
                                        className="room-slot"
                                        aria-label={`${r.name} ${time.date} ${time.period}교시 ${kind === "general" ? "감독" : kind === "main" ? "정" : "부"} 배정`}
                                        disabled={stale || running}
                                        onClick={() => openCandidate(s.id)}
                                      >
                                        {t ? labelTeacher(d, t) : "미배정"}
                                      </button>
                                    ) : (
                                      <span>—</span>
                                    )}
                                  </td>
                                );
                              }),
                            )}
                          </tr>
                        ))}
                </tbody>
              </table>
            </div>
            <div className="workflow-legend">
              <span>
                <i className="selected-key" />
                선택
              </span>
              <span>
                <i className="possible-key" />
                교환 가능
              </span>
              <span>
                <i className="conflict-key" />
                교환 불가
              </span>
              <span>
                <i className="unavailable-key" />
                배정 불가 · 사유 표시
              </span>
              <span>배정안 #{d.result.seed}</span>
            </div>
          </Panel>
          {showIssues && (
            <Modal
              title={`결과 검증 · ${needCheck.length}건`}
              onClose={() => setShowIssues(false)}
              footer={
                <button onClick={() => setShowIssues(false)}>닫기</button>
              }
            >
              {!needCheck.length ? (
                <div className="all-good">
                  <Check size={18} />
                  금지 조건 위반, 미배정, 횟수 초과가 없습니다.
                </div>
              ) : (
                <div className="issue-list">
                  {needCheck.map((i, n) => (
                    <div
                      key={n}
                      className={`issue ${i.severity === "error" ? "error" : ""}`}
                    >
                      <AlertTriangle size={16} />
                      <span>{i.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </Modal>
          )}
        </>
      )}
      {activeSlot && (
        <Modal
          title="감독 교사 배정"
          subtitle={`${d.rooms.find((r) => r.id === activeSlot.roomId)?.name} · ${formatDay(activeSlot.date)} ${activeSlot.period}교시 · ${kinds[activeSlot.kind]}`}
          onClose={() => setCandidateSlot(null)}
          footer={
            <>
              <button onClick={() => setCandidateSlot(null)}>취소</button>
              <button
                className="danger-soft"
                disabled={!assigned.get(activeSlot.id)}
                onClick={() => {
                  if (
                    stage(
                      plan.map((a) =>
                        a.slotId === activeSlot.id
                          ? { ...a, teacherId: null }
                          : a,
                      ),
                    )
                  )
                    setCandidateSlot(null);
                }}
              >
                배정 해제
              </button>
              <button
                className="primary"
                disabled={
                  !candidate ||
                  !!candidates.find((x) => x.teacher.id === candidate)?.reasons
                    .length
                }
                onClick={() => {
                  if (
                    stage(
                      plan.map((a) =>
                        a.slotId === activeSlot.id
                          ? { ...a, teacherId: candidate }
                          : a,
                      ),
                    )
                  )
                    setCandidateSlot(null);
                }}
              >
                선택 교사 배정
              </button>
            </>
          }
        >
          <SearchBox
            label="배정할 교사 검색"
            value={candidateQuery}
            onChange={setCandidateQuery}
          />
          <div className="candidate-list">
            {candidates.map(({ teacher: t, reasons }) => (
              <label
                key={t.id}
                className={
                  reasons.length
                    ? "unavailable"
                    : candidate === t.id
                      ? "selected"
                      : ""
                }
              >
                <input
                  type="radio"
                  name="candidate"
                  value={t.id}
                  disabled={!!reasons.length}
                  checked={candidate === t.id}
                  onChange={() => setCandidate(t.id)}
                />
                <strong>{labelTeacher(d, t)}</strong>
                <span>
                  {reasons.length
                    ? reasons.join(" · ")
                    : `배정 가능 · 현재 ${slots.filter((s) => assigned.get(s.id) === t.id).length}회`}
                </span>
              </label>
            ))}
          </div>
          <p className="settings-note">
            선택한 배정은 임시로 조정됩니다. 표에서 ‘변경사항 반영’을 눌러
            저장하세요.
          </p>
        </Modal>
      )}
    </div>
  );
}
