import { useState } from "react";
import { CalendarSearch } from "lucide-react";
import { TimetableImport } from "./TimetableImport";
import { ExamDocument, Teacher, key } from "../domain/model";
import { isDesignated, placementOf, type Placement } from "../domain/rules";
import {
  Edit,
  Empty,
  formatDay,
  labelTeacher,
  placementLabels,
  roles,
  SearchBox,
  StepFooter,
} from "./WorkflowShared";

type Time = { date: string; period: number };

/**
 * Two separate steps so the meaning of a check never changes within one table:
 * "designated" — designated teachers, check = must proctor this period;
 * "blocked" — normal teachers, check = cannot proctor this period.
 */
export function TeacherTimes({
  d,
  edit,
  step,
  onNext,
  notify,
}: {
  d: ExamDocument;
  edit: Edit;
  step: "designated" | "blocked";
  onNext: () => void;
  notify: (s: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [date, setDate] = useState("");
  const designatedStep = step === "designated";
  const days = d.dates.filter((x) => !date || x.date === date);
  const allTimes = d.dates.flatMap((x) =>
    Array.from({ length: x.periods }, (_, i) => ({
      date: x.date,
      period: i + 1,
    })),
  );
  const times = allTimes.filter((x) => !date || x.date === date);
  const labels = placementLabels(d.settings.mode);
  const lastPeriod = (time: Time) =>
    time.period === days.find((y) => y.date === time.date)!.periods;
  const change = (t: Teacher, fn: (a: Teacher) => void) =>
    edit((x) => fn(x.teachers.find((a) => a.id === t.id)!));
  const canProctor = (t: Teacher, time: Time) => {
    const listed = t.availability?.some((x) => key(x) === key(time)) ?? false;
    const legacyExcluded = t.exclusions.some((x) => key(x) === key(time));
    if (isDesignated(t)) return listed && !legacyExcluded;
    return (t.availability === null || listed) && !legacyExcluded;
  };
  const setCanProctor = (t: Teacher, time: Time, can: boolean) =>
    change(t, (a) => {
      a.exclusions = a.exclusions.filter((x) => key(x) !== key(time));
      const base = a.availability ?? (isDesignated(a) ? [] : allTimes);
      a.availability = base.filter((x) => key(x) !== key(time));
      if (can) a.availability.push(time);
      if (!isDesignated(a) && a.availability.length >= allTimes.length)
        a.availability = null;
    });
  const group = d.teachers.filter((t) =>
    designatedStep ? isDesignated(t) : t.role === "normal",
  );
  const shown = group.filter((t) =>
    `${t.name} ${roles[t.role]}`.includes(query),
  );
  const help = designatedStep
    ? "특별교사(지정배치·시간강사·비교과·순회·복도 전담)는 체크한 교시에만, 체크한 교시마다 반드시 감독합니다. 감독하는 교시에 체크하고 배치 자리를 고르세요."
    : "일반 교사는 체크하지 않은 교시에서 자동으로 고르게 배정됩니다. 출장·육아시간 등으로 감독할 수 없는 교시에만 체크하세요.";
  return (
    <section className={`time-settings step-${step}`}>
      <p className="step-intro">{help}</p>
      {!group.length ? (
        <Empty>
          {designatedStep
            ? "특별교사(지정배치·시간강사·비교과·순회·복도 전담)가 없습니다. 교사 명단의 ‘비고 / 역할’에서 정하거나, 없으면 다음 단계로 넘어가세요."
            : "일반 교사가 없습니다."}
        </Empty>
      ) : !times.length ? (
        <Empty>시험일정을 먼저 등록하세요.</Empty>
      ) : (
        <>
          <div className="workflow-filter">
            <SearchBox value={query} onChange={setQuery} />
            <select
              aria-label="가능 시간 날짜"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            >
              <option value="">전체 날짜</option>
              {d.dates.map((x) => (
                <option key={x.date}>{x.date}</option>
              ))}
            </select>
            <button
              className="primary push-right"
              onClick={() => setImporting(true)}
            >
              <CalendarSearch size={16} />
              시간표에서 불러오기
            </button>
          </div>
          <div className="workflow-table-scroll time-scroll">
            <table className="proctor-matrix time-matrix">
              <thead>
                <tr>
                  <th rowSpan={2} className="sticky-name">
                    교사명
                  </th>
                  {days.map((x) => (
                    <th key={x.date} colSpan={x.periods} className="date-end">
                      {formatDay(x.date)}
                    </th>
                  ))}
                  <th rowSpan={2}>{designatedStep ? "배치 자리" : "사유"}</th>
                  <th rowSpan={2}>초기화</th>
                </tr>
                <tr>
                  {times.map((x) => (
                    <th key={key(x)} className={lastPeriod(x) ? "date-end" : ""}>
                      {x.period}교시
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((t, row) => (
                  <tr
                    key={t.id}
                    className={designatedStep ? "designated-row" : undefined}
                  >
                    <th className="sticky-name">
                      {labelTeacher(d, t)}
                      {designatedStep && (
                        <small className="role-tag">{roles[t.role]}</small>
                      )}
                    </th>
                    {times.map((time) => {
                      const can = canProctor(t, time);
                      const on = designatedStep ? can : !can;
                      return (
                        <td
                          key={key(time)}
                          className={`time-cell ${on ? (designatedStep ? "time-designated" : "time-blocked") : ""} ${lastPeriod(time) ? "date-end" : ""}`}
                        >
                          <label className="time-check">
                            <input
                              type="checkbox"
                              aria-label={`${t.name} ${time.date} ${time.period}교시 ${designatedStep ? "지정배치" : "불가"}`}
                              checked={on}
                              onChange={(e) =>
                                setCanProctor(
                                  t,
                                  time,
                                  designatedStep
                                    ? e.target.checked
                                    : !e.target.checked,
                                )
                              }
                            />
                          </label>
                        </td>
                      );
                    })}
                    <td className={designatedStep ? "placement-cell" : ""}>
                      {designatedStep ? (
                        <select
                          aria-label={`${t.name} 배치 자리`}
                          value={placementOf(t)}
                          onChange={(e) =>
                            change(t, (a) => {
                              a.placement = e.target.value as Placement;
                            })
                          }
                        >
                          {(
                            [
                              "hallwayFirst",
                              "classroomFirst",
                              "any",
                              "hallwayOnly",
                            ] as const
                          ).map((p) => (
                            <option key={p} value={p}>
                              {labels[p]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={`${t.name} 불가 사유`}
                          placeholder={row === 0 ? "출장, 육아시간 등" : undefined}
                          value={
                            t.exclusionReason ?? t.exclusions[0]?.reason ?? ""
                          }
                          onChange={(e) =>
                            change(t, (a) => {
                              a.exclusionReason = e.target.value;
                              a.exclusions.forEach(
                                (v) => (v.reason = e.target.value),
                              );
                            })
                          }
                        />
                      )}
                    </td>
                    <td>
                      <button
                        aria-label={`${t.name} 초기화`}
                        onClick={() =>
                          change(t, (a) => {
                            a.availability = null;
                            a.exclusions = [];
                          })
                        }
                      >
                        체크 해제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {designatedStep && (
            <p className="inline-help">
              배치 자리가 “{labels.hallwayFirst}”이면 감독이 부족할 때{" "}
              {d.settings.mode === "mainSub" ? "정감독" : "교과 감독"}에도
              들어가고, “{labels.hallwayOnly}”이면 들어가지 않습니다.
            </p>
          )}
        </>
      )}
      {importing && (
        <TimetableImport
          d={d}
          edit={edit}
          notify={notify}
          mode={step}
          onClose={() => setImporting(false)}
        />
      )}
      <StepFooter
        onNext={onNext}
        label={designatedStep ? "감독불가 교사 설정" : "감독 방식·배정 기준"}
      />
    </section>
  );
}
