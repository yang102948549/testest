// CalendarUI.html teacher/date cards; ExclusionUI.html full teacher x period matrix.
import { useState } from "react";
import { ExamDocument, Teacher, key } from "../domain/model";
import {
  Edit,
  Empty,
  Panel,
  SearchBox,
  StepFooter,
  formatDay,
  labelTeacher,
  roles,
} from "./WorkflowShared";
export function Availability({
  d,
  edit,
  onNext,
}: {
  d: ExamDocument;
  edit: Edit;
  onNext: () => void;
}) {
  const [query, setQuery] = useState(""),
    [scope, setScope] = useState(
      d.teachers.some((t) => t.role !== "normal") ? "special" : "all",
    );
  const times = d.dates.flatMap((day) =>
    Array.from({ length: day.periods }, (_, i) => ({
      date: day.date,
      period: i + 1,
    })),
  );
  const update = (id: string, fn: (t: Teacher) => void) =>
    edit((x) => fn(x.teachers.find((t) => t.id === id)!));
  const list = d.teachers.filter(
    (t) =>
      (scope === "all" || t.role !== "normal" || t.note) &&
      `${t.name} ${roles[t.role]}`.includes(query),
  );
  return (
    <div className="original-workflow">
      <Panel
        title="감독 가능 날짜 설정"
        description="교사별로 가능한 날짜·교시를 선택하세요. 일반 교사는 기본적으로 모든 시간이 가능합니다."
      >
        <div className="workflow-filter">
          <div className="workflow-tabs">
            <button
              className={scope === "special" ? "active" : ""}
              onClick={() => setScope("special")}
            >
              비고·역할 지정 교사
            </button>
            <button
              className={scope === "all" ? "active" : ""}
              onClick={() => setScope("all")}
            >
              전체 교사
            </button>
          </div>
          <SearchBox value={query} onChange={setQuery} />
        </div>
        {!d.dates.length ? (
          <Empty>시험일정을 먼저 등록해 주세요.</Empty>
        ) : !list.length ? (
          <Empty>
            해당 교사가 없습니다. 전체 교사 탭에서 확인할 수 있습니다.
          </Empty>
        ) : (
          <div className="availability-cards">
            {list.map((t) => {
              const excluded = t.role === "excluded";
              return (
                <article
                  key={t.id}
                  className={`availability-card ${excluded ? "fully-excluded" : ""}`}
                >
                  <header>
                    <div>
                      <h3>
                        {labelTeacher(d, t)} <span>{roles[t.role]}</span>
                      </h3>
                      <p>
                        {t.note ||
                          (t.availability === null
                            ? "모든 교시에 감독 가능합니다."
                            : t.availability.length === 0
                              ? "전체 불가로 설정되어 있습니다."
                              : `${t.availability.length}개 교시를 선택했습니다.`)}
                      </p>
                    </div>
                    <div className="actions">
                      <button
                        disabled={excluded}
                        onClick={() =>
                          update(t.id, (a) => {
                            a.availability = null;
                          })
                        }
                      >
                        초기화 · 전체 가능
                      </button>
                      <button
                        className="danger-soft"
                        disabled={excluded}
                        onClick={() =>
                          update(t.id, (a) => {
                            a.availability = [];
                          })
                        }
                      >
                        전체 불가
                      </button>
                    </div>
                  </header>
                  <div className="availability-dates">
                    {d.dates.map((day) => (
                      <div className="availability-day" key={day.date}>
                        <strong>{formatDay(day.date)}</strong>
                        <div className="period-choice-list">
                          {Array.from(
                            { length: day.periods },
                            (_, i) => i + 1,
                          ).map((p) => {
                            const time = { date: day.date, period: p },
                              checked =
                                !excluded &&
                                (t.availability === null ||
                                  t.availability.some(
                                    (a) => key(a) === key(time),
                                  ));
                            return (
                              <label
                                key={p}
                                className={checked ? "checked" : ""}
                              >
                                <input
                                  aria-label={`${t.name} ${day.date} ${p}교시 가능`}
                                  type="checkbox"
                                  checked={checked}
                                  disabled={excluded}
                                  onChange={(e) =>
                                    update(t.id, (a) => {
                                      const old = a.availability ?? times;
                                      a.availability = e.target.checked
                                        ? [
                                            ...old.filter(
                                              (v) => key(v) !== key(time),
                                            ),
                                            time,
                                          ]
                                        : old.filter(
                                            (v) => key(v) !== key(time),
                                          );
                                    })
                                  }
                                />
                                <span>{p}교시</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  {excluded && (
                    <p className="field-error">
                      완전 제외 교사입니다. 교사 기본 설정에서 역할을 변경해야
                      배정할 수 있습니다.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Panel>
      <StepFooter onNext={onNext} label="제외 교시 설정" />
    </div>
  );
}
export function Exclusions({
  d,
  edit,
  onNext,
}: {
  d: ExamDocument;
  edit: Edit;
  onNext: () => void;
}) {
  const [query, setQuery] = useState(""),
    [all, setAll] = useState(false),
    [dateFilter, setDateFilter] = useState("");
  const dates = d.dates.filter((x) => !dateFilter || x.date === dateFilter),
    times = dates.flatMap((day) =>
      Array.from({ length: day.periods }, (_, i) => ({
        date: day.date,
        period: i + 1,
      })),
    );
  const list = d.teachers.filter(
    (t) => (all || t.role === "normal") && t.name.includes(query),
  );
  const update = (id: string, fn: (t: Teacher) => void) =>
    edit((x) => fn(x.teachers.find((t) => t.id === id)!));
  return (
    <div className="original-workflow">
      <Panel
        title="감독 제외 교시 설정"
        description="제외할 교시를 체크하고 오른쪽에 사유를 입력하세요. 날짜별로 전체 교사의 설정을 비교할 수 있습니다."
      >
        <div className="workflow-filter">
          <div className="actions">
            <SearchBox value={query} onChange={setQuery} />
            <label className="check-label">
              <input
                type="checkbox"
                checked={all}
                onChange={(e) => setAll(e.target.checked)}
              />
              역할 지정 교사도 표시
            </label>
          </div>
          <select
            aria-label="제외 날짜 필터"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          >
            <option value="">전체 날짜</option>
            {d.dates.map((day) => (
              <option value={day.date} key={day.date}>
                {formatDay(day.date)}
              </option>
            ))}
          </select>
        </div>
        {!d.dates.length || !d.teachers.length ? (
          <Empty>시험일정과 교사를 먼저 등록해 주세요.</Empty>
        ) : (
          <div className="workflow-table-scroll exclusion-scroll">
            <table className="exclusion-matrix">
              <thead>
                <tr>
                  <th rowSpan={2} className="sticky-name">
                    교사명
                  </th>
                  {dates.map((day, i) => (
                    <th
                      key={day.date}
                      colSpan={day.periods}
                      className={`day-color-${i % 3} date-end`}
                    >
                      {formatDay(day.date)}
                    </th>
                  ))}
                  <th rowSpan={2} className="reason-column">
                    사유 입력
                  </th>
                </tr>
                <tr>
                  {times.map((t, i) => (
                    <th
                      key={key(t)}
                      className={
                        t.period ===
                        dates.find((d) => d.date === t.date)!.periods
                          ? "date-end"
                          : ""
                      }
                    >
                      {t.period}교시
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id}>
                    <th className="sticky-name">
                      {labelTeacher(d, t)}
                      {t.role !== "normal" && <small>{roles[t.role]}</small>}
                    </th>
                    {times.map((time) => {
                      const ex = t.exclusions.find((x) => key(x) === key(time));
                      return (
                        <td
                          key={key(time)}
                          title={ex?.reason}
                          className={`${ex ? "excluded-cell" : ""} ${time.period === dates.find((d) => d.date === time.date)!.periods ? "date-end" : ""}`}
                        >
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`${t.name} ${time.date} ${time.period}교시 제외`}
                              checked={!!ex}
                              onChange={(e) =>
                                update(t.id, (a) => {
                                  a.exclusions = a.exclusions.filter(
                                    (x) => key(x) !== key(time),
                                  );
                                  if (e.target.checked)
                                    a.exclusions.push({
                                      ...time,
                                      reason:
                                        a.exclusionReason ??
                                        a.exclusions[0]?.reason ??
                                        "",
                                    });
                                })
                              }
                            />
                          </label>
                        </td>
                      );
                    })}
                    <td className="reason-column">
                      <input
                        aria-label={`${t.name} 제외 사유`}
                        placeholder="예: 출장, 교과수업"
                        value={
                          t.exclusionReason ?? t.exclusions[0]?.reason ?? ""
                        }
                        onChange={(e) =>
                          update(t.id, (a) => {
                            a.exclusionReason = e.target.value;
                            a.exclusions.forEach((v) => {
                              v.reason = e.target.value;
                            });
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="workflow-legend">
          <span>
            <i className="excluded-key" />
            선택한 교시에는 배정하지 않습니다.
          </span>
          <span>
            사유를 수정하면 해당 교사의 선택된 교시에 함께 적용합니다.
          </span>
        </div>
      </Panel>
      <StepFooter onNext={onNext} label="배정 세부 설정" />
    </div>
  );
}
