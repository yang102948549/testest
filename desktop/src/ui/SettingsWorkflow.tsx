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
        description="지정배치·충원·자리 선호를 우선하고, 일반 교사의 가중 점수 차이를 최소화합니다."
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
                  step: "any",
                },
                {
                  key: "hallwayWeight",
                  label: "복도 감독",
                  step: "any",
                },
              ] as const
            ).map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  aria-label={f.label + " 가중치"}
                  type="number"
                  min={0}
                  step={f.step}
                  value={d.settings[f.key]}
                  onChange={(e) =>
                    edit((x) => {
                      const value = e.target.valueAsNumber;
                      if (Number.isFinite(value) && value >= 0)
                        x.settings[f.key] = value;
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div>
            <h3>감독 횟수 참고 기준</h3>
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
            <span>하루 3회 이상 교실 감독 경고 해제</span>
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
          가중치는 0 이상의 소수도 입력할 수 있습니다. 점수 격차를 먼저 줄이고,
          동률이면 평균과의 차이를 줄입니다. 횟수 기준은 참고 경고이며 배정을
          제한하지 않습니다. 담당 과목·제외 시간·담임·감독불가 학급·중복 배정
          금지는 항상 유지됩니다.
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
            번호는 탐색 시작점을 바꿉니다. 계산은 약 10초를 기준으로 하며, 시간
            내 최적성을 확인하지 못하면 확보한 배치안을 표시합니다.
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
