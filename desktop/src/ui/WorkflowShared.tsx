import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Search, X } from "lucide-react";
import { ExamDocument, Teacher } from "../domain/model";

export type Edit = (
  fn: (d: ExamDocument) => void,
  opts?: { persist?: boolean },
) => void;
export type Ask = (value: {
  title: string;
  text: string;
  run: () => void;
}) => void;
export const roles: Record<Teacher["role"], string> = {
  normal: "일반 교사",
  designated: "지정배치",
  lecturer: "시간강사",
  support: "비교과",
  roaming: "순회",
  hallway: "복도 전담",
  excluded: "감독 제외",
};
/** Seat preference labels; wording follows the proctoring mode. */
export function placementLabels(mode: ExamDocument["settings"]["mode"]) {
  const [main, sub] = mode === "mainSub" ? ["정감독", "부감독"] : ["교과", "복도"];
  return {
    hallwayFirst: `${sub} 우선`,
    classroomFirst: `${main} 우선`,
    any: `${main}·${sub} 모두`,
    hallwayOnly: `${sub}만`,
  } as const;
}
export const kinds = {
  classroom: "교실",
  hallway: "복도",
  main: "정",
  sub: "부",
};
export const subjects = [
  "국어",
  "문학",
  "독서",
  "수학",
  "영어",
  "한국사",
  "사회",
  "과학",
  "물리",
  "화학",
  "생명과학",
  "지구과학",
  "역사",
  "도덕",
  "정보",
  "기술·가정",
  "체육",
  "음악",
  "미술",
  "한문",
  "일본어",
  "중국어",
];
export const labelTeacher = (d: ExamDocument, t: Teacher) =>
  `${t.name}${d.teachers.filter((x) => x.name === t.name).length > 1 ? ` (${t.id.slice(-4)})` : ""}`;
export const formatDay = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="workflow-panel">
      <div className="workflow-panel-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function StepFooter({
  onNext,
  label,
}: {
  onNext: () => void;
  label: string;
}) {
  return (
    <div className="step-footer">
      <span>저장하지 않은 변경은 다른 화면으로 가면 사라집니다. Ctrl+S로도 저장할 수 있습니다.</span>
      <button className="primary" onClick={onNext}>
        저장 및 다음 단계 <ChevronRight size={17} />
        <small>{label}</small>
      </button>
    </div>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="workflow-empty">{children}</div>;
}
export function SearchBox({
  value,
  onChange,
  label = "교사 검색",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="workflow-search">
      <Search size={17} />
      <input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const box = ref.current!;
    const focus = box.querySelector<HTMLElement>(
      "[autofocus],input,button,select",
    );
    focus?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const els = Array.from(
          box.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
          ),
        ).filter((x) => x.offsetParent !== null);
        if (!els.length) return;
        const first = els[0],
          last = els.at(-1)!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    box.addEventListener("keydown", listener);
    return () => {
      box.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="workflow-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`workflow-modal ${wide ? "wide" : ""}`}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            aria-label="선택창 닫기"
            className="icon-btn"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        <div className="workflow-modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
export function GridPicker({
  title,
  options,
  value,
  single = false,
  onApply,
  onClose,
  allowNew = false,
  groups,
}: {
  title: string;
  options: { id: string; name: string; group?: string }[];
  value: string[];
  single?: boolean;
  onApply: (ids: string[]) => void;
  onClose: () => void;
  allowNew?: boolean;
  groups?: string[];
}) {
  const [selected, setSelected] = useState(value),
    [extra, setExtra] = useState<{ id: string; name: string }[]>([]),
    [input, setInput] = useState(""),
    [group, setGroup] = useState(groups?.[0]);
  const all = [...options, ...extra],
    shown = all.filter((x) => !group || !("group" in x) || x.group === group);
  const toggle = (id: string) =>
    setSelected((old) =>
      old.includes(id)
        ? old.filter((x) => x !== id)
        : single
          ? [id]
          : [...old, id],
    );
  return (
    <Modal
      title={title}
      subtitle={
        single
          ? "하나의 학급을 선택하세요. 선택한 항목을 다시 누르면 해제됩니다."
          : "여러 항목을 클릭하여 선택할 수 있습니다."
      }
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>취소</button>
          <button
            className="primary"
            onClick={() => {
              onApply(selected);
              onClose();
            }}
          >
            선택 완료
          </button>
        </>
      }
    >
      {allowNew && (
        <div className="inline-form">
          <input
            autoFocus
            aria-label="새 과목"
            placeholder="새 과목 직접 입력"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) {
                const name = input.trim();
                if (!all.some((x) => x.id === name))
                  setExtra((v) => [...v, { id: name, name }]);
                setSelected((v) => (v.includes(name) ? v : [...v, name]));
                setInput("");
              }
            }}
          />
          <button
            disabled={!input.trim()}
            onClick={() => {
              const name = input.trim();
              if (!all.some((x) => x.id === name))
                setExtra((v) => [...v, { id: name, name }]);
              setSelected((v) => (v.includes(name) ? v : [...v, name]));
              setInput("");
            }}
          >
            + 추가
          </button>
        </div>
      )}
      {groups && (
        <div className="workflow-tabs">
          {groups.map((g) => (
            <button
              key={g}
              className={g === group ? "active" : ""}
              onClick={() => setGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}
      <div className="picker-tools">
        <span>{selected.length}개 선택</span>
        <button onClick={() => setSelected([])}>전체 해제</button>
        {!single && (
          <button
            onClick={() =>
              setSelected([
                ...new Set([...selected, ...shown.map((x) => x.id)]),
              ])
            }
          >
            모두 선택
          </button>
        )}
      </div>
      <div className="selection-grid">
        {shown.map((x) => (
          <button
            type="button"
            aria-pressed={selected.includes(x.id)}
            className={selected.includes(x.id) ? "selected" : ""}
            onClick={() => toggle(x.id)}
            key={x.id}
          >
            <span>{x.name}</span>
            <span className="selection-mark" aria-hidden="true">
              {selected.includes(x.id) && <Check size={14} />}
            </span>
          </button>
        ))}
      </div>
      {!shown.length && <Empty>시험 설정에서 학급을 먼저 등록해 주세요.</Empty>}
    </Modal>
  );
}
