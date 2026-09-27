// SettingsUI.html settings groups + SubProctorSettingUI.html room tile cards.
import { ExamDocument, key } from "../domain/model";
import { slotsFor } from "../domain/rules";
import { Edit, Panel, formatDay } from "./WorkflowShared";
export function Settings({
  d,
  edit,
  onRun,
  running,
}: {
  d: ExamDocument;
  edit: Edit;
  onRun: () => void;
  running: boolean;
}) {
  const slots = slotsFor(d);
  return (
    <div className="original-workflow">
      <Panel
        title="감독 배정 세부 설정"
        description="감독 방식과 가중치·횟수 제한을 확인한 뒤 배정을 실행하세요."
      >
        <div className="mode-card">
          <div>
            <h3>정/부감독 모드</h3>
            <p>
              {d.settings.mode === "mainSub"
                ? "정감독·부감독을 배정합니다. 일반 모드의 가중치와 상한은 적용하지 않습니다."
                : "교실 감독과 복도 감독을 배정합니다."}
            </p>
          </div>
          <label className="switch">
            <input
              aria-label="정/부감독 모드"
              type="checkbox"
              checked={d.settings.mode === "mainSub"}
              onChange={(e) =>
                edit((x) => {
                  x.settings.mode = e.target.checked ? "mainSub" : "general";
                })
              }
            />
            <span />
          </label>
        </div>
        <fieldset
          className="original-settings"
          disabled={d.settings.mode === "mainSub"}
        >
          <div>
            <h3>감독 가중치</h3>
            {(
              [
                {
                  key: "classroomWeight",
                  label: "교실 감독",
                  step: 0.5,
                  max: 100,
                },
                {
                  key: "hallwayWeight",
                  label: "복도 감독",
                  step: 0.5,
                  max: 100,
                },
              ] as const
            ).map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  aria-label={f.label + " 가중치"}
                  type="number"
                  min={0}
                  max={f.max}
                  step={f.step}
                  value={d.settings[f.key]}
                  onChange={(e) =>
                    edit((x) => {
                      x.settings[f.key] = Math.max(
                        0,
                        Math.min(f.max, +e.target.value),
                      );
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div>
            <h3>감독 횟수 제한</h3>
            {(
              [
                {
                  key: "maxClassroom",
                  label: "전체 기간 교실 감독",
                  max: 1000,
                },
                { key: "maxHallway", label: "하루 복도 감독", max: 12 },
              ] as const
            ).map((f) => (
              <label key={f.key}>
                {f.label}
                <span>
                  <input
                    aria-label={f.label + " 상한"}
                    type="number"
                    min={0}
                    max={f.max}
                    value={d.settings[f.key]}
                    onChange={(e) =>
                      edit((x) => {
                        x.settings[f.key] = Math.floor(
                          Math.max(0, Math.min(f.max, +e.target.value)),
                        );
                      })
                    }
                  />{" "}
                  회
                </span>
              </label>
            ))}
          </div>
          <label className="daily-option">
            <span>하루 3회 이상 교실 감독 허용</span>
            <input
              type="checkbox"
              checked={d.settings.allowThird}
              onChange={(e) =>
                edit((x) => {
                  x.settings.allowThird = e.target.checked;
                })
              }
            />
          </label>
        </fieldset>
        <p className="settings-note">
          빈자리가 남으면 횟수 상한을 완화하고 결과에 초과 내역을 표시합니다.
          담당 과목·제외 시간·중복 배정 금지는 항상 유지됩니다.
        </p>
        <details className="advanced-settings" open>
          <summary>다른 배정안 만들기</summary>
          <label>
            배정안 번호
            <input
              aria-label="배정안 번호"
              type="number"
              min={0}
              max={2147483647}
              value={d.settings.seed}
              onChange={(e) =>
                edit((x) => {
                  x.settings.seed = Math.floor(
                    Math.max(0, Math.min(2147483647, +e.target.value)),
                  );
                })
              }
            />
          </label>
          <p>
            입력과 번호가 같으면 같은 결과를 만듭니다. 다른 배정안을 보려면
            번호를 바꾸세요.
          </p>
        </details>
      </Panel>
      {d.settings.mode === "mainSub" && (
        <Panel
          title="단독 감독 고사실 세부 설정"
          description="정감독만 배치할 고사실을 클릭하세요. 선택하지 않은 고사실은 정·부감독을 함께 배치합니다."
        >
          {d.dates.map((day) => (
            <div className="single-day-card" key={day.date}>
              <h3>{formatDay(day.date)}</h3>
              {Array.from({ length: day.periods }, (_, i) => i + 1).map((p) => {
                const ss = slots.filter(
                  (s) =>
                    s.date === day.date && s.period === p && s.kind === "main",
                );
                if (!ss.length) return null;
                const selfStudy = ss.every((s) => s.selfStudy);
                return (
                  <div className="single-period" key={p}>
                    <strong>
                      {p}교시 {selfStudy && <small>자습 · 자동 단독</small>}
                    </strong>
                    <div className="room-selection-grid">
                      {ss.map((s) => {
                        const selected =
                          selfStudy ||
                          d.singleRooms.some(
                            (x) => key(x) === key(s) && x.roomId === s.roomId,
                          );
                        return (
                          <button
                            key={s.id}
                            disabled={selfStudy}
                            aria-pressed={selected}
                            className={selected ? "selected" : ""}
                            onClick={() =>
                              edit((x) => {
                                x.singleRooms = x.singleRooms.filter(
                                  (a) =>
                                    !(
                                      key(a) === key(s) && a.roomId === s.roomId
                                    ),
                                );
                                if (!selected)
                                  x.singleRooms.push({
                                    date: s.date,
                                    period: s.period,
                                    roomId: s.roomId,
                                  });
                              })
                            }
                          >
                            {d.rooms.find((r) => r.id === s.roomId)?.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </Panel>
      )}
      <div className="step-footer">
        <span>설정을 저장하고 감독을 배정합니다.</span>
        <button className="primary" disabled={running} onClick={onRun}>
          설정 저장 및 감독 배정 실행
        </button>
      </div>
    </div>
  );
}
