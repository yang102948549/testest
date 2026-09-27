// Interaction structure ported from ScheduleUI.html: grade room chips,
// date cards with period x grade cells, and a staged subject/room modal.
import { useEffect, useRef, useState } from "react";
import { Plus, X, Minus, FlaskConical, Trash2 } from "lucide-react";
import { ExamDocument, uid, key } from "../domain/model";
import { sortedRooms } from "../domain/rules";
import { RoomToken } from "./RoomToken";
import { Calendar, DateField } from "./DatePicker";
import {
  Ask,
  Edit,
  Empty,
  Modal,
  Panel,
  StepFooter,
  formatDay,
  subjects,
} from "./WorkflowShared";

type Lesson = ExamDocument["lessons"][number];
export function Schedule({
  d,
  edit,
  ask,
  onSample,
  onNext,
}: {
  d: ExamDocument;
  edit: Edit;
  ask: Ask;
  onSample: () => void;
  onNext: () => void;
}) {
  const [modal, setModal] = useState<{
    date: string;
    period: number;
    grade: number;
    lessons: Lesson[];
  } | null>(null);
  const [dateDialog, setDateDialog] = useState(false),
    // Several exam days can be picked at once in the add dialog.
    [newDates, setNewDates] = useState<string[]>([]);
  const [roomCounts, setRoomCounts] = useState([5, 5, 5]);
  const [roomsOpen, setRoomsOpen] = useState(true);
  useEffect(() => setRoomsOpen(true), [d.id]);
  const removeRoom = (id: string) =>
    ask({
      title: "고사실을 삭제할까요?",
      text: "연결된 과목·담임·이동학급도 정리됩니다.",
      run: () =>
        edit((x) => {
          x.rooms = x.rooms.filter((r) => r.id !== id);
          x.lessons.forEach(
            (l) => (l.roomIds = l.roomIds.filter((r) => r !== id)),
          );
          x.teachers.forEach((t) => {
            if (t.homeroom === id) t.homeroom = null;
            t.movingRooms = t.movingRooms.filter((r) => r !== id);
          });
          x.singleRooms = x.singleRooms.filter((r) => r.roomId !== id);
        }),
    });
  const addRooms = (
    grade: number,
    count = 1,
    kind: ExamDocument["rooms"][number]["kind"] = "classroom",
  ) =>
    edit((x) => {
      const old = x.rooms.filter((r) => r.grade === grade && r.kind === kind);
      const added: ExamDocument["rooms"] = [];
      let n = 1;
      while (added.length < count) {
        const name =
          kind === "classroom"
            ? `${grade}-${n}`
            : kind === "hallway"
              ? `복도 ${n}`
              : `특별실 ${n}`;
        if (
          !x.rooms.some((r) => r.name === name) &&
          !added.some((r) => r.name === name)
        )
          added.push({ id: uid(), name, grade, kind });
        n++;
      }
      x.rooms.push(...added);
      if (kind === "classroom" && old.length)
        x.lessons
          .filter(
            (l) =>
              l.grade === grade &&
              l.roomIds.length === old.length &&
              old.every((r) => l.roomIds.includes(r.id)),
          )
          .forEach((l) => l.roomIds.push(...added.map((r) => r.id)));
    });
  const cleanTimes = (x: ExamDocument) => {
    const valid = (t: { date: string; period: number }) =>
      x.dates.some((day) => day.date === t.date && t.period <= day.periods);
    x.lessons = x.lessons.filter(valid);
    x.singleRooms = x.singleRooms.filter(valid);
    x.teachers.forEach((t) => {
      if (t.availability) t.availability = t.availability.filter(valid);
      t.exclusions = t.exclusions.filter(valid);
    });
  };
  // Cells commit on blur, so read the latest document when the detail dialog opens.
  const latest = useRef(d);
  latest.current = d;
  const openCell = (
    date: string,
    period: number,
    grade: number,
    split = false,
  ) => {
    const d = latest.current;
    const ls = d.lessons.filter(
      (l) => l.date === date && l.period === period && l.grade === grade,
    );
    const lessons: Lesson[] =
      ls.length
        ? structuredClone(ls)
        : [
            {
              id: uid(),
              date,
              period,
              grade,
              subject: "",
              roomIds: d.rooms
                .filter((r) => r.kind === "classroom" && r.grade === grade)
                .map((r) => r.id),
            },
          ];
    if (split)
      lessons.push({
        id: uid(),
        date,
        period,
        grade,
        subject: "",
        roomIds: [],
      });
    setModal({ date, period, grade, lessons });
  };
  const roomChips = (rooms: ExamDocument["rooms"]) => (
    <div className="editable-chips">
      {sortedRooms(rooms).map((r) => (
        <RoomToken
          key={r.id}
          name={r.name}
          onRename={(name) =>
            edit((x) => {
              x.rooms.find((a) => a.id === r.id)!.name = name;
            })
          }
          onDelete={() => removeRoom(r.id)}
        />
      ))}
    </div>
  );
  return (
    <div className="original-workflow schedule-workflow">
      <datalist id="exam-subject-list">
        {[...subjects, "자습"].map((s) => (
          <option key={s}>{s}</option>
        ))}
      </datalist>
      {!d.dates.length && !d.teachers.length && (
        <div className="workflow-intro">
          <p>학급을 등록한 뒤, 날짜별 표에서 시험 과목을 선택하세요.</p>
          <button onClick={onSample}>
            <FlaskConical size={17} />
            예시 고사 둘러보기
          </button>
        </div>
      )}
      <div className="exam-title-field">
        <label>
          고사 이름
          <input
            aria-label="고사 이름"
            value={d.title}
            onChange={(e) =>
              edit((x) => {
                x.title = e.target.value;
              })
            }
          />
        </label>
      </div>
      <details
        className="room-disclosure"
        open={roomsOpen}
        onToggle={(e) => setRoomsOpen(e.currentTarget.open)}
      >
        <summary>
          고사실 관리 <span>{d.rooms.length}실 · 학년별 교실, 복도·특별실</span>
        </summary>
        <Panel
          title="학년별 고사실"
          description="학급을 추가하고, 이름을 누르면 수정할 수 있습니다."
        >
          <div className="grade-room-grid">
            {[1, 2, 3].map((g) => (
              <div className="grade-room-box" key={g}>
                <header>
                  <h3>
                    {g}학년{" "}
                    <span>
                      {
                        d.rooms.filter(
                          (r) => r.grade === g && r.kind === "classroom",
                        ).length
                      }
                      실
                    </span>
                  </h3>
                  <button
                    aria-label={`${g}학년 고사실 추가`}
                    onClick={() => addRooms(g)}
                  >
                    <Plus size={15} />
                    추가
                  </button>
                </header>
                {roomChips(
                  d.rooms.filter(
                    (r) => r.grade === g && r.kind === "classroom",
                  ),
                )}
                <div className="room-bulk">
                  <input
                    type="number"
                    aria-label={`${g}학년 추가할 학급 수`}
                    min={1}
                    max={30}
                    value={roomCounts[g - 1]}
                    onChange={(e) =>
                      setRoomCounts((v) =>
                        v.map((x, i) =>
                          i === g - 1
                            ? Math.max(1, Math.min(30, +e.target.value))
                            : x,
                        ),
                      )
                    }
                  />
                  <span>개 학급</span>
                  <button onClick={() => addRooms(g, roomCounts[g - 1])}>
                    한 번에 추가
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title="복도·특별실"
          description="시험 과목이 있는 교시에 배치합니다. 자습에는 복도 감독을 배치하지 않습니다."
        >
          <div className="extra-room-grid">
            {(["hallway", "special"] as const).map((kind) => (
              <div className="grade-room-box" key={kind}>
                <header>
                  <h3>{kind === "hallway" ? "복도 감독 구역" : "특별실"}</h3>
                  <button
                    aria-label={`${kind === "hallway" ? "복도" : "특별실"} 추가`}
                    onClick={() => addRooms(1, 1, kind)}
                  >
                    <Plus size={15} />
                    추가
                  </button>
                </header>
                {roomChips(d.rooms.filter((r) => r.kind === kind))}
              </div>
            ))}
          </div>
        </Panel>
      </details>
      <Panel
        title="시험 일정"
        description="칸에 과목을 바로 입력하세요. 방향키로 칸을 옮기고 Enter는 아래 칸으로 갑니다. 반마다 과목이 다르면 칸의 ‘+ 반별 과목’을 누르세요."
        action={
          <button
            onClick={() => {
              setNewDates([]);
              setDateDialog(true);
            }}
          >
            <Plus size={16} />
            시험일 추가
          </button>
        }
      >
        {!d.dates.length ? (
          <Empty>‘시험일 추가’를 눌러 첫 시험일을 등록하세요.</Empty>
        ) : (
          <div className="exam-date-grid">
            {d.dates.map((day) => (
              <article className="exam-date-card" key={day.date}>
                <header>
                  <div>
                    <h3>{formatDay(day.date)}</h3>
                    <DateField
                      label={`${day.date} 날짜 변경`}
                      value={day.date}
                      marked={d.dates.map((a) => a.date)}
                      disabled={(date) =>
                        date !== day.date && d.dates.some((a) => a.date === date)
                      }
                      onChange={(date) => {
                        if (date === day.date) return;
                        edit((x) => {
                          x.dates.find((a) => a.date === day.date)!.date = date;
                          [
                            ...x.lessons,
                            ...x.singleRooms,
                            ...x.teachers.flatMap((t) => [
                              ...(t.availability ?? []),
                              ...t.exclusions,
                            ]),
                          ].forEach((a) => {
                            if (a.date === day.date) a.date = date;
                          });
                          x.dates.sort((a, b) => a.date.localeCompare(b.date));
                        });
                      }}
                    />
                  </div>
                  <div className="actions">
                    <div
                      className="period-stepper"
                      role="group"
                      aria-label={`${day.date} 교시 수`}
                    >
                      <span>
                        <b>{day.periods}</b>교시
                      </span>
                      <button
                        aria-label={`${day.date} 교시 줄이기`}
                        title="마지막 교시 삭제"
                        disabled={day.periods <= 1}
                        onClick={() =>
                          ask({
                            title: `${day.periods}교시를 삭제할까요?`,
                            text: "해당 교시의 과목과 지정·불가 교시 설정도 삭제됩니다.",
                            run: () =>
                              edit((x) => {
                                x.dates.find((a) => a.date === day.date)!
                                  .periods--;
                                cleanTimes(x);
                              }),
                          })
                        }
                      >
                        <Minus size={14} />
                      </button>
                      <button
                        aria-label={`${day.date} 교시 추가`}
                        title="교시 추가"
                        disabled={day.periods >= 12}
                        onClick={() =>
                          edit((x) => {
                            x.dates.find((a) => a.date === day.date)!.periods++;
                          })
                        }
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <button
                      title="시험일 삭제"
                      aria-label={`${day.date} 시험일 삭제`}
                      className="icon-btn"
                      onClick={() =>
                        ask({
                          title: "시험일을 삭제할까요?",
                          text: "해당 날짜의 연결된 설정도 삭제됩니다.",
                          run: () =>
                            edit((x) => {
                              x.dates = x.dates.filter(
                                (a) => a.date !== day.date,
                              );
                              cleanTimes(x);
                            }),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </header>
                <table className="schedule-grid">
                  <thead>
                    <tr>
                      <th>교시</th>
                      {[1, 2, 3].map((g) => (
                        <th key={g}>{g}학년</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: day.periods }, (_, i) => i + 1).map(
                      (p) => (
                        <tr key={p}>
                          <th>
                            {p}
                            <small>교시</small>
                          </th>
                          {[1, 2, 3].map((g) => (
                            <SubjectCell
                              key={g}
                              d={d}
                              edit={edit}
                              date={day.date}
                              period={p}
                              grade={g}
                              onDetail={(split) =>
                                openCell(day.date, p, g, split)
                              }
                            />
                          ))}
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </article>
            ))}
          </div>
        )}
      </Panel>
      <StepFooter onNext={onNext} label="교사 기본 설정" />
      {dateDialog && (
        <Modal
          title="시험일 추가"
          onClose={() => setDateDialog(false)}
          footer={
            <>
              <button onClick={() => setDateDialog(false)}>취소</button>
              <button
                className="primary"
                disabled={!newDates.length || d.dates.length + newDates.length > 60}
                onClick={() => {
                  edit((x) => {
                    for (const date of newDates)
                      x.dates.push({ date, periods: 3 });
                    x.dates.sort((a, b) => a.date.localeCompare(b.date));
                  });
                  setDateDialog(false);
                }}
              >
                {newDates.length ? `${newDates.length}일 추가` : "날짜 추가"}
              </button>
            </>
          }
        >
          <Calendar
            selected={newDates}
            marked={d.dates.map((x) => x.date)}
            initial={d.dates.at(-1)?.date}
            disabled={(date) => d.dates.some((x) => x.date === date)}
            onPick={(date) =>
              setNewDates((list) =>
                list.includes(date)
                  ? list.filter((x) => x !== date)
                  : [...list, date].sort(),
              )
            }
          />
          <p className="calendar-note">
            {newDates.length
              ? newDates.map((x) => formatDay(x)).join(", ")
              : "시험 날짜를 누르세요. 여러 날을 한 번에 고를 수 있습니다. 점은 이미 등록된 날입니다."}
          </p>
        </Modal>
      )}
      {modal && (
        <Modal
          wide
          title="과목 / 고사실 설정"
          subtitle={`${formatDay(modal.date)} · ${modal.period}교시 · ${modal.grade}학년`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button onClick={() => setModal(null)}>취소</button>
              <button
                className="primary"
                onClick={() => {
                  const target = modal;
                  edit((x) => {
                    x.lessons = x.lessons.filter(
                      (l) =>
                        !(
                          l.date === target.date &&
                          l.period === target.period &&
                          l.grade === target.grade
                        ),
                    );
                    x.lessons.push(
                      ...target.lessons
                        .filter((l) => l.subject.trim())
                        .map((l) => ({ ...l, subject: l.subject.trim() })),
                    );
                  });
                  setModal(null);
                }}
              >
                적용완료
              </button>
            </>
          }
        >
          {modal.lessons.map((l, i) => {
            const rooms = sortedRooms(d.rooms).filter(
              (r) => r.kind === "classroom" && r.grade === modal.grade,
            );
            const change = (fn: (a: Lesson) => void) =>
              setModal((m) => {
                if (!m) return m;
                const copy = structuredClone(m);
                fn(copy.lessons[i]);
                return copy;
              });
            return (
              <div className="modal-subject-block" key={l.id}>
                <div className="subject-input-line">
                  <input
                    autoFocus={i === 0}
                    aria-label={`과목명 ${i + 1}`}
                    list="exam-subject-list"
                    value={l.subject}
                    placeholder="과목명 입력 (예: 물리 / 화학)"
                    onChange={(e) =>
                      change((a) => {
                        a.subject = e.target.value;
                      })
                    }
                  />
                  <button
                    aria-label={`과목 ${i + 1} 삭제`}
                    className="icon-btn"
                    onClick={() =>
                      setModal((m) =>
                        m
                          ? {
                              ...m,
                              lessons: m.lessons.filter((a) => a.id !== l.id),
                            }
                          : null,
                      )
                    }
                  >
                    <X size={18} />
                  </button>
                </div>
                {i === 0 && (
                <p>
                  반마다 과목이 다르면 아래 ‘과목 추가’로 과목을 더하고 반을
                  나눠 고르세요. 한 반은 한 과목에만 속합니다. 같은 반이 두
                  과목을 함께 보면 쉼표(,)로 적으세요.
                </p>
                )}
                <div className="picker-tools">
                  <strong>
                    적용 고사실 <small>{l.roomIds.length}실</small>
                  </strong>
                  <button
                    onClick={() =>
                      setModal((m) => {
                        if (!m) return m;
                        const copy = structuredClone(m);
                        copy.lessons.forEach((o, k) => {
                          o.roomIds = k === i ? rooms.map((r) => r.id) : [];
                        });
                        return copy;
                      })
                    }
                  >
                    전체 선택
                  </button>
                  <button
                    onClick={() =>
                      change((a) => {
                        a.roomIds = [];
                      })
                    }
                  >
                    전체 해제
                  </button>
                </div>
                <div className="room-selection-grid">
                  {rooms.map((r) => (
                    <button
                      aria-pressed={l.roomIds.includes(r.id)}
                      className={l.roomIds.includes(r.id) ? "selected" : ""}
                      key={r.id}
                      onClick={() =>
                        setModal((m) => {
                          if (!m) return m;
                          const copy = structuredClone(m);
                          const on = copy.lessons[i].roomIds.includes(r.id);
                          copy.lessons.forEach((o, k) => {
                            o.roomIds = o.roomIds.filter((id) => id !== r.id);
                            if (k === i && !on) o.roomIds.push(r.id);
                          });
                          return copy;
                        })
                      }
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
                {!rooms.length && (
                  <p className="field-error">
                    이 학년의 고사실을 먼저 등록해 주세요.
                  </p>
                )}
              </div>
            );
          })}
          <button
            className="dashed-add"
            onClick={() =>
              setModal((m) =>
                m
                  ? {
                      ...m,
                      lessons: [
                        ...m.lessons,
                        {
                          id: uid(),
                          date: m.date,
                          period: m.period,
                          grade: m.grade,
                          subject: "",
                          // Rooms not taken by another subject yet.
                          roomIds: d.rooms
                            .filter(
                              (r) =>
                                r.kind === "classroom" &&
                                r.grade === m.grade &&
                                !m.lessons.some((o) => o.roomIds.includes(r.id)),
                            )
                            .map((r) => r.id),
                        },
                      ],
                    }
                  : null,
              )
            }
          >
            <Plus size={17} />
            과목 추가
          </button>
        </Modal>
      )}
    </div>
  );
}

/**
 * Type the subject straight into the cell. Arrow keys move between cells like a
 * spreadsheet (left/right only at the edge of the text), Enter moves down.
 * "+ 반별 과목" opens the subject/room dialog when classes take different subjects.
 */
function moveCell(from: HTMLElement, key: string) {
  const [date, period, grade] = from.dataset.cell!.split("|");
  const cells = [...document.querySelectorAll<HTMLElement>("[data-cell]")];
  const at = (p: number, g: number) =>
    cells.find((c) => c.dataset.cell === `${date}|${p}|${g}`);
  let target: HTMLElement | undefined;
  if (key === "ArrowUp") target = at(+period - 1, +grade);
  else if (key === "ArrowDown") target = at(+period + 1, +grade);
  else {
    // Same period across grades and on to the neighbouring exam day.
    const row = cells.filter((c) => c.dataset.cell!.split("|")[1] === period);
    const i = row.indexOf(from);
    target = row[key === "ArrowLeft" ? i - 1 : i + 1];
  }
  if (!target) return false;
  target.focus();
  if (target instanceof HTMLInputElement) target.select();
  return true;
}
function SubjectCell({
  d,
  edit,
  date,
  period,
  grade,
  onDetail,
}: {
  d: ExamDocument;
  edit: Edit;
  date: string;
  period: number;
  grade: number;
  onDetail: (split: boolean) => void;
}) {
  const same = (l: Lesson, g = grade) =>
    l.date === date && l.period === period && l.grade === g;
  const ls = d.lessons.filter((l) => same(l));
  const gradeRooms = (x: ExamDocument, g: number) =>
    x.rooms
      .filter((r) => r.kind === "classroom" && r.grade === g)
      .map((r) => r.id);
  const current = ls.length === 1 ? ls[0].subject : "";
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);
  const commit = () => {
    const v = draft.trim();
    if (v === current.trim()) return;
    edit((x) => {
      const old = x.lessons.find((l) => same(l));
      x.lessons = x.lessons.filter((l) => !same(l));
      if (v)
        x.lessons.push({
          id: old?.id ?? uid(),
          date,
          period,
          grade,
          subject: v,
          roomIds: old?.roomIds ?? gradeRooms(x, grade),
        });
    });
  };
  const rooms = gradeRooms(d, grade).length;
  const used = new Set(ls.flatMap((l) => l.roomIds)).size;
  const label = `${date} ${period}교시 ${grade}학년`;
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <td className={`subject-td ${ls.length ? "filled" : ""}`}>
      {ls.length > 1 ? (
        <button
          className="subject-multi"
          aria-label={`${label} 반별 과목 보기`}
          data-cell={`${date}|${period}|${grade}`}
          onClick={() => onDetail(false)}
          onKeyDown={(e) => {
            if (e.key.startsWith("Arrow") && moveCell(e.currentTarget, e.key))
              e.preventDefault();
          }}
        >
          {ls.map((l) => (
            <span key={l.id}>
              {l.subject} <small>{l.roomIds.length}실</small>
            </span>
          ))}
        </button>
      ) : (
        <input
          className="subject-input"
          list="exam-subject-list"
          aria-label={`${label} 과목`}
          data-cell={`${date}|${period}|${grade}`}
          placeholder="과목"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(current);
              e.currentTarget.blur();
            }
            if (e.nativeEvent.isComposing) return;
            const el = e.currentTarget;
            if (e.key === "Enter") {
              e.preventDefault();
              if (!moveCell(el, "ArrowDown")) el.blur();
              return;
            }
            // Just-arrived cells have their text selected: arrows keep moving.
            const all =
              el.selectionStart === 0 && el.selectionEnd === el.value.length;
            const atStart =
              all || (el.selectionStart === 0 && el.selectionEnd === 0);
            const atEnd =
              all ||
              (el.selectionStart === el.value.length &&
                el.selectionEnd === el.value.length);
            if (
              e.key === "ArrowUp" ||
              e.key === "ArrowDown" ||
              (e.key === "ArrowLeft" && atStart) ||
              (e.key === "ArrowRight" && atEnd)
            ) {
              if (moveCell(el, e.key)) e.preventDefault();
            }
          }}
        />
      )}
      <div className="cell-tools">
        {ls.length === 1 && used < rooms && (
          <span className="room-count partial">
            {used}/{rooms}실
          </span>
        )}
        <button
          tabIndex={-1}
          className="split-subject"
          title="반마다 다른 과목을 볼 때"
          aria-label={`${label} 과목 설정`}
          onMouseDown={keep}
          onClick={() => {
            const split = draft.trim() !== "" && ls.length <= 1;
            commit();
            setTimeout(() => onDetail(split), 0);
          }}
        >
          {ls.length > 1 ? "편집" : "+ 반별 과목"}
        </button>
      </div>
    </td>
  );
}
