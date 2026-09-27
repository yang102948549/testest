import { useState } from "react";
import { desktop } from "../bridge";
import { ExamDocument } from "../domain/model";
import { ExportOptions, buildWorkbook, shortDay } from "../domain/exportBook";
import { Modal } from "./WorkflowShared";

/** Excel export: whole-exam sheets plus printable per-day sheets. */
export function ExportDialog({
  d,
  stale,
  notify,
  onClose,
}: {
  d: ExamDocument;
  stale: boolean;
  notify: (s: string) => void;
  onClose: () => void;
}) {
  const [opts, setOpts] = useState<ExportOptions>({
    dates: d.dates.map((x) => x.date),
    layout: "combined",
    overview: true,
  });
  const [busy, setBusy] = useState(false);
  const layouts = [
    ["combined", "교사별 + 고사실별", "한 장에 두 표를 나란히"],
    ["teacher", "교사별", "교사마다 감독할 고사실"],
    ["room", "고사실별", "고사실마다 감독 교사"],
  ] as const;
  return (
    <Modal
      title="엑셀로 내보내기"
      subtitle="날짜별 감독표는 A4 가로로 인쇄되도록 맞춰 저장합니다."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            disabled={busy || (!opts.dates.length && !opts.overview)}
            onClick={async () => {
              setBusy(true);
              try {
                const sheets = buildWorkbook(d, d.result!.assignments, opts);
                if (await desktop!.exportXlsx(d.title, sheets)) {
                  notify(`엑셀 파일로 내보냈습니다 (시트 ${sheets.length}개).`);
                  onClose();
                }
              } catch (e) {
                notify(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "저장 중…" : "엑셀 파일 저장"}
          </button>
        </>
      }
    >
      {stale && (
        <p className="field-error" role="alert">
          배정 후 기초 설정이 바뀌었습니다. 내보내기 전에 재검증하거나 다시
          배정하는 것을 권장합니다.
        </p>
      )}
      <div className="export-section">
        <h3>날짜별 감독표</h3>
        <div className="export-dates">
          {d.dates.map((x) => {
            const on = opts.dates.includes(x.date);
            return (
              <label key={x.date} className={on ? "on" : ""}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setOpts((o) => ({
                      ...o,
                      dates: on
                        ? o.dates.filter((a) => a !== x.date)
                        : [...o.dates, x.date],
                    }))
                  }
                />
                {shortDay(x.date)}
              </label>
            );
          })}
        </div>
        <div className="export-layouts" role="radiogroup" aria-label="감독표 양식">
          {layouts.map(([value, name, hint]) => (
            <label key={value} className={opts.layout === value ? "on" : ""}>
              <input
                type="radio"
                name="export-layout"
                checked={opts.layout === value}
                onChange={() => setOpts((o) => ({ ...o, layout: value }))}
              />
              <span>
                <b>{name}</b>
                <small>{hint}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
      <label className="export-overview">
        <input
          type="checkbox"
          checked={opts.overview}
          onChange={(e) => setOpts((o) => ({ ...o, overview: e.target.checked }))}
        />
        <span>
          <b>전체 배정표 포함</b>
          <small>교사별 전체(누적 횟수·배정점수)와 고사실별 전체 시트</small>
        </span>
      </label>
    </Modal>
  );
}
