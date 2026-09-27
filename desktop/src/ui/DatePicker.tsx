// Google-Calendar-style month picker, after the rounded jQuery UI picker in
// the original ScheduleUI.html: month title with round arrows, circular days,
// today ringed, selection filled, exam days dotted.
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const today = () => new Date().toLocaleDateString("en-CA");

export function Calendar({
  selected,
  onPick,
  marked = [],
  disabled = () => false,
  initial,
}: {
  selected: string[];
  onPick: (date: string) => void;
  /** Dates to dot (existing exam days). */
  marked?: string[];
  disabled?: (date: string) => boolean;
  initial?: string;
}) {
  const start = initial ?? selected[0] ?? today();
  const [view, setView] = useState({
    y: Number(start.slice(0, 4)),
    m: Number(start.slice(5, 7)) - 1,
  });
  const move = (n: number) =>
    setView(({ y, m }) => {
      const t = new Date(y, m + n, 1);
      return { y: t.getFullYear(), m: t.getMonth() };
    });
  const first = new Date(view.y, view.m, 1).getDay();
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  const now = today();
  return (
    <div className="calendar">
      <div className="calendar-head">
        <b>
          {view.y}년 {view.m + 1}월
        </b>
        <button
          type="button"
          className="calendar-today"
          onClick={() => {
            const t = today();
            setView({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) - 1 });
          }}
        >
          오늘
        </button>
        <button type="button" aria-label="이전 달" onClick={() => move(-1)}>
          <ChevronLeft size={18} />
        </button>
        <button type="button" aria-label="다음 달" onClick={() => move(1)}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="calendar-grid" role="grid">
        {["일", "월", "화", "수", "목", "금", "토"].map((w, i) => (
          <span key={w} className={`calendar-week w${i}`}>
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={`e${i}`} />;
          const date = iso(view.y, view.m, day);
          const off = disabled(date);
          return (
            <button
              type="button"
              key={date}
              aria-label={date}
              aria-pressed={selected.includes(date)}
              disabled={off}
              className={[
                "calendar-day",
                `w${i % 7}`,
                selected.includes(date) && "selected",
                date === now && "today",
                marked.includes(date) && "marked",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onPick(date)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A date shown as text; clicking it opens the calendar in a popover. */
export function DateField({
  value,
  onChange,
  label,
  marked,
  disabled,
}: {
  value: string;
  onChange: (date: string) => void;
  label: string;
  marked?: string[];
  disabled?: (date: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span className="date-field" ref={box}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {value.replaceAll("-", ". ")}
        <CalendarDays size={14} />
      </button>
      {open && (
        <div className="calendar-popover">
          <Calendar
            selected={[value]}
            marked={marked}
            disabled={disabled}
            onPick={(date) => {
              onChange(date);
              setOpen(false);
            }}
          />
        </div>
      )}
    </span>
  );
}
