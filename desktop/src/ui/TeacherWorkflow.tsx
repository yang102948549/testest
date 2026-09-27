// TeacherUI.html chip containers and staged subject/class grid pickers.
import { useState } from "react";
import { FileSpreadsheet, Plus, Trash2, X } from "lucide-react";
import { ExamDocument, Teacher, uid } from "../domain/model";
import { isDesignated, sortedRooms } from "../domain/rules";
import { TeacherImport } from "./TeacherImport";
import {
  Ask,
  Edit,
  Empty,
  GridPicker,
  Modal,
  Panel,
  SearchBox,
  StepFooter,
  labelTeacher,
  roles,
  subjects,
} from "./WorkflowShared";
/** Editing the field an import note is about clears that note. */
function resolveReview(t: Teacher, prefix: string) {
  if (!t.review) return;
  t.review = t.review.filter((x) => !x.startsWith(prefix));
  if (!t.review.length) delete t.review;
}
export function Teachers({
  d,
  edit,
  ask,
  onNext,
}: {
  d: ExamDocument;
  edit: Edit;
  ask: Ask;
  onNext: () => void;
}) {
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState(""),
    [picker, setPicker] = useState<{
      id: string;
      field: "subjects" | "homeroom" | "movingRooms";
    } | null>(null);
  const add = (name = "새 교사", list: string[] = []): Teacher => ({
    id: uid(),
    name,
    subjects: list,
    homeroom: null,
    movingRooms: [],
    role: "normal",
    note: "",
    availability: null,
    exclusions: [],
  });
  const update = (id: string, fn: (t: Teacher) => void) =>
    edit((x) => fn(x.teachers.find((a) => a.id === id)!));
  const t = d.teachers.find((x) => x.id === picker?.id);
  const options = [
    ...new Set([
      ...subjects,
      ...d.lessons
        .flatMap((l) => l.subject.split(/[,/]/).map((x) => x.trim()))
        .filter((x) => x && x !== "자습"),
      ...d.teachers.flatMap((t) => t.subjects),
    ]),
  ];
  return (
    <div className="original-workflow">
      <Panel
        title="교사 기본 정보 설정"
        description="과목·담임·이동학급 칸을 클릭해 선택하세요. 복수 과목과 여러 이동학급을 지정할 수 있습니다."
        action={
          <div className="actions">
            <button className="ghost" onClick={() => setImporting(true)}>
              <FileSpreadsheet size={16} />
              엑셀·Google Sheets 가져오기
            </button>
            {!!d.teachers.length && (
              <button
                className="destructive"
                onClick={() =>
                  ask({
                    title: `교사 ${d.teachers.length}명을 모두 삭제할까요?`,
                    text: "명단과 가능 시간 설정이 모두 지워집니다. 기존 배정 결과는 재검증이 필요합니다.",
                    run: () =>
                      edit((x) => {
                        x.teachers = [];
                      }),
                  })
                }
              >
                <Trash2 size={16} />
                전체 삭제
              </button>
            )}
            <button
              onClick={() =>
                edit((x) => {
                  x.teachers.push(add());
                })
              }
            >
              <Plus size={16} />
              교사 추가
            </button>
          </div>
        }
      >
        <div className="workflow-filter">
          <SearchBox
            value={query}
            onChange={setQuery}
            label="이름 또는 담당과목 검색"
          />
          <span>전체 {d.teachers.length}명</span>
        </div>
        {!d.teachers.length ? (
          <Empty>
            기존 명단이 있다면 ‘엑셀·Google Sheets 가져오기’를 누르세요. 직접
            교사를 추가할 수도 있습니다.
          </Empty>
        ) : (
          <div className="workflow-table-scroll">
            <table className="original-teacher-table">
              <thead>
                <tr>
                  <th>순번</th>
                  <th>교사명</th>
                  <th>
                    담당과목 <small>복수 선택</small>
                  </th>
                  <th>담임</th>
                  <th>
                    이동학급 <small>다중 선택</small>
                  </th>
                  <th>비고 / 역할</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.teachers
                  .filter((t) =>
                    `${t.name} ${t.subjects.join(" ")}`.includes(query),
                  )
                  .map((t) => (
                    <tr key={t.id}>
                      <td className="row-number">
                        {d.teachers.indexOf(t) + 1}
                      </td>
                      <td>
                        <input
                          className="name-field"
                          aria-label="교사명"
                          value={t.name}
                          onChange={(e) =>
                            update(t.id, (a) => {
                              a.name = e.target.value;
                            })
                          }
                        />
                        {d.teachers.filter((x) => x.name === t.name).length >
                          1 && (
                          <small className="duplicate-label">
                            ID {t.id.slice(-4)}
                          </small>
                        )}
                        {!!t.review?.length && (
                          <button
                            className="review-badge"
                            title={t.review.join(" / ")}
                            aria-label={`${t.name} 수정 필요`}
                            onClick={() =>
                              ask({
                                title: `${t.name} · 수정 필요`,
                                text: `${t.review!.join(" / ")}. 해당 칸을 고치면 자동으로 사라집니다. 확인을 누르면 표시를 지웁니다.`,
                                run: () =>
                                  update(t.id, (a) => {
                                    delete a.review;
                                  }),
                              })
                            }
                          >
                            수정 필요
                          </button>
                        )}
                      </td>
                      <td>
                        <button
                          className="chip-field"
                          aria-label={`${t.name} 담당과목 선택`}
                          onClick={() =>
                            setPicker({ id: t.id, field: "subjects" })
                          }
                        >
                          {t.subjects.length ? (
                            t.subjects.map((s) => (
                              <span className="data-chip subject" key={s}>
                                {s}
                              </span>
                            ))
                          ) : (
                            <span className="placeholder">+ 과목 선택</span>
                          )}
                        </button>
                      </td>
                      <td>
                        <button
                          className="chip-field"
                          aria-label={`${t.name} 담임 학급 선택`}
                          onClick={() =>
                            setPicker({ id: t.id, field: "homeroom" })
                          }
                        >
                          {t.homeroom ? (
                            <span className="data-chip homeroom">
                              {d.rooms.find((r) => r.id === t.homeroom)?.name}
                            </span>
                          ) : (
                            <span className="placeholder">담임 선택</span>
                          )}
                        </button>
                      </td>
                      <td>
                        <button
                          className="chip-field"
                          aria-label={`${t.name} 이동 학급 선택`}
                          onClick={() =>
                            setPicker({ id: t.id, field: "movingRooms" })
                          }
                        >
                          {t.movingRooms.length ? (
                            t.movingRooms.map((id) => (
                              <span key={id} className="data-chip moving">
                                {d.rooms.find((r) => r.id === id)?.name}
                              </span>
                            ))
                          ) : (
                            <span className="placeholder">+ 이동학급</span>
                          )}
                        </button>
                      </td>
                      <td>
                        <select
                          aria-label={`${t.name} 역할`}
                          className={`role-chip role-${t.role}`}
                          value={t.role}
                          onChange={(e) =>
                            update(t.id, (a) => {
                              resolveReview(a, "역할");
                              const was = isDesignated(a);
                              a.role = e.target.value as Teacher["role"];
                              a.placement = undefined;
                              // Checked periods flip meaning (possible vs designated), so start clean.
                              if (was !== isDesignated(a)) {
                                a.availability = null;
                                a.exclusions = [];
                              }
                            })
                          }
                        >
                          {Object.entries(roles).map(([v, n]) => (
                            <option key={v} value={v}>
                              {n}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label={`${t.name} 메모`}
                          className="teacher-note"
                          placeholder="추가 메모"
                          value={t.note}
                          onChange={(e) =>
                            update(t.id, (a) => {
                              a.note = e.target.value;
                            })
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="icon-btn"
                          title={`${t.name} 삭제`}
                          onClick={() =>
                            ask({
                              title: `${t.name} 교사를 삭제할까요?`,
                              text: "기존 배정 결과는 재검증이 필요합니다.",
                              run: () =>
                                edit((x) => {
                                  x.teachers = x.teachers.filter(
                                    (a) => a.id !== t.id,
                                  );
                                }),
                            })
                          }
                        >
                          <X size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <button
          className="dashed-add"
          onClick={() =>
            edit((x) => {
              x.teachers.push(add());
            })
          }
        >
          <Plus size={17} />
          교사 행 추가
        </button>
      </Panel>
      <StepFooter onNext={onNext} label="특별교사 감독 설정" />
      {importing && (
        <TeacherImport d={d} edit={edit} onClose={() => setImporting(false)} />
      )}
      {picker && t && (
        <GridPicker
          title={
            picker.field === "subjects"
              ? "담당과목 선택"
              : picker.field === "homeroom"
                ? "담임 학급 선택"
                : "이동 학급 선택 (다중)"
          }
          options={
            picker.field === "subjects"
              ? options.map((s) => ({ id: s, name: s }))
              : sortedRooms(d.rooms)
                  .filter((r) => r.kind === "classroom")
                  .map((r) => ({
                    id: r.id,
                    name: r.name,
                    group: `${r.grade}학년`,
                  }))
          }
          value={
            picker.field === "subjects"
              ? t.subjects
              : picker.field === "homeroom"
                ? t.homeroom
                  ? [t.homeroom]
                  : []
                : t.movingRooms
          }
          single={picker.field === "homeroom"}
          allowNew={picker.field === "subjects"}
          groups={
            picker.field === "subjects"
              ? undefined
              : ["1학년", "2학년", "3학년"]
          }
          onClose={() => setPicker(null)}
          onApply={(v) =>
            update(t.id, (a) => {
              if (picker.field === "subjects") a.subjects = v;
              else if (picker.field === "homeroom") {
                a.homeroom = v[0] ?? null;
                resolveReview(a, "담임");
              } else {
                a.movingRooms = v;
                resolveReview(a, "이동학급");
              }
            })
          }
        />
      )}
    </div>
  );
}
