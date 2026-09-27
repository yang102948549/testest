import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Users,
  ShieldCheck,
  LayoutGrid,
  Archive,
  Plus,
  ArrowUpRight,
  ChevronRight,
  Play,
  Square,
  Undo2,
  FileSpreadsheet,
  Redo2,
  Download,
  Upload,
  Check,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  FlaskConical,
  AlertTriangle,
  RefreshCw,
  ArrowLeftRight,
  Trash2,
  Search,
  CircleHelp,
} from "lucide-react";
import {
  Assignment,
  ExamDocument,
  Issue,
  Result,
  Teacher,
  blank,
  documentSchema,
  fingerprint,
  key,
  sample,
  uid,
} from "../domain/model";
import {
  assertManual,
  forbidden,
  slotsFor,
  subjectMap,
  validate,
  weight,
} from "../domain/rules";
import { desktop, RecordEntry } from "../bridge";
import { Schedule } from "./ScheduleWorkflow";
import { Teachers } from "./TeacherWorkflow";
import { TeacherTimes } from "./TeacherTimes";
import { ExportDialog } from "./ExportDialog";
import { Settings } from "./SettingsWorkflow";
import { Assignments } from "./AssignmentWorkflow";

type Page =
  | "schedule"
  | "teachers"
  | "availability"
  | "exclusions"
  | "settings"
  | "assignments"
  | "records";
type Edit = (
  fn: (d: ExamDocument) => void,
  opts?: { persist?: boolean },
) => void;
const roles: Record<Teacher["role"], string> = {
  normal: "일반 교사",
  designated: "지정배치",
  lecturer: "시간강사",
  support: "비교과",
  roaming: "순회",
  hallway: "복도 전담",
  excluded: "감독 제외",
};
const kindNames = {
  classroom: "교실",
  hallway: "복도",
  main: "정감독",
  sub: "부감독",
};
const groups = [
  {
    id: "schedule" as const,
    label: "시험 설정",
    icon: CalendarDays,
    pages: ["schedule", "settings"],
  },
  {
    id: "teachers" as const,
    label: "교사 설정",
    icon: Users,
    pages: ["teachers", "availability", "exclusions"],
  },
  {
    id: "assignments" as const,
    label: "배정표",
    icon: LayoutGrid,
    pages: ["assignments"],
  },
  { id: "records" as const, label: "기록", icon: Archive, pages: ["records"] },
];
const tabs: Partial<Record<Page, { id: Page; label: string }[]>> = {
  schedule: [
    { id: "schedule", label: "일정·고사실" },
    { id: "settings", label: "감독 방식·배정 기준" },
  ],
  teachers: [
    { id: "teachers", label: "교사 명단" },
    { id: "availability", label: "특별교사 감독 설정" },
    { id: "exclusions", label: "감독불가 교사 설정" },
  ],
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const stamp = (s: string) =>
  s
    ? new Date(s).toLocaleString("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const shortDate = (s: string) => s.slice(5).replace("-", ".");
const teacherLabel = (d: ExamDocument, t: Teacher) =>
  `${t.name}${d.teachers.filter((x) => x.name === t.name).length > 1 ? ` (${t.subjects.join("·") || "과목 없음"} / ${t.id.slice(-4)})` : ""}`;

export function App() {
  const [manualDraft, setManualState] = useState<Assignment[] | null>(null);
  const manualRef = useRef<Assignment[] | null>(null);
  const setManualDraft = useCallback((value: Assignment[] | null) => {
    manualRef.current = value;
    setManualState(value);
  }, []);
  const [d, setD] = useState<ExamDocument>(blank),
    [page, setPage] = useState<Page>("schedule"),
    [ready, setReady] = useState(false),
    [saveStatus, setSaveStatus] = useState("불러오는 중"),
    [notice, setNotice] = useState(""),
    [collapsed, setCollapsed] = useState(false);
  const [running, setRunning] = useState(false),
    [progress, setProgress] = useState(0),
    [history, setHistory] = useState<ExamDocument[]>([]),
    [future, setFuture] = useState<ExamDocument[]>([]),
    [leave, setLeave] = useState<Page | "close" | null>(null),
    [exporting, setExporting] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    text: string;
    run: () => void;
  } | null>(null);
  const current = useRef(d),
    // Last persisted document; leaving without saving restores it.
    baseline = useRef(d),
    dirty = useRef(false),
    worker = useRef<Worker | null>(null),
    runInput = useRef(""),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((s: string) => setNotice(s), []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const loaded = await desktop?.current();
        if (!alive) return;
        if (loaded) {
          current.current = loaded.document;
          baseline.current = loaded.document;
          setD(loaded.document);
          if (loaded.recovered)
            notify("원본 파일을 읽을 수 없어 직전 정상 백업을 열었습니다.");
        }
        setSaveStatus(desktop ? "저장됨" : "브라우저 미리보기 · 저장 불가");
      } catch (e) {
        if (alive) {
          notify(message(e));
          setSaveStatus("복원 실패 · 기록 또는 파일 가져오기");
        }
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [notify]);
  const save = useCallback(async () => {
    if (!desktop) return;
    const snapshot = current.current;
    if (!dirty.current) return;
    const parsed = documentSchema.safeParse(snapshot);
    if (!parsed.success)
      throw new Error(
        "저장하지 못했습니다: " +
          parsed.error.issues
            .slice(0, 3)
            .map((x) => x.message)
            .join(", "),
      );
    await desktop.save(parsed.data);
    baseline.current = snapshot;
    if (snapshot === current.current) {
      dirty.current = false;
      setSaveStatus("저장됨");
    }
  }, []);
  useEffect(
    () =>
      desktop?.onClosing(() => {
        if (manualRef.current) {
          setConfirm({
            title: "반영하지 않은 배정 조정이 있습니다",
            text: "배정표에서 변경사항을 반영하거나 조정을 취소할 수 있습니다. 확인을 누르면 임시 조정을 버리고 앱을 닫습니다.",
            run: () => {
              void save()
                .then(() => desktop!.close())
                .catch((e) => setNotice(message(e)));
            },
          });
          return;
        }
        if (dirty.current) {
          setLeave("close");
          return;
        }
        void (async () => {
          try {
            worker.current?.terminate();
            await desktop!.close();
          } catch (e) {
            setConfirm({
              title: "저장하지 못했습니다",
              text:
                message(e) +
                "\n앱으로 돌아가 입력을 수정하거나, 마지막 저장 상태만 남기고 닫을 수 있습니다.",
              run: () => {
                void desktop!.close();
              },
            });
          }
        })();
      }),
    [save],
  );
  useEffect(() => () => worker.current?.terminate(), []);
  const markDirty = () => {
    dirty.current = true;
    setSaveStatus(desktop ? "저장 안 됨" : "브라우저 미리보기 · 저장 불가");
  };
  const edit: Edit = (fn, opts) => {
    const old = current.current,
      next = structuredClone(old);
    fn(next);
    next.updatedAt = new Date().toISOString();
    setHistory((h) => [...h.slice(-49), old]);
    setFuture([]);
    current.current = next;
    markDirty();
    setD(next);
    if (opts?.persist)
      void save().catch((e) => {
        setSaveStatus("저장 실패");
        notify(message(e));
      });
  };
  const saveNow = () =>
    save().catch((e) => {
      setSaveStatus("저장 실패");
      notify(message(e));
      throw e;
    });
  const discard = () => {
    current.current = baseline.current;
    dirty.current = false;
    setD(baseline.current);
    setHistory([]);
    setFuture([]);
    setSaveStatus("저장됨");
  };
  // Moving to another screen with unsaved edits asks first.
  const go = (target: Page) => {
    if (target === page) return;
    if (dirty.current && !manualRef.current) setLeave(target);
    else setPage(target);
  };
  const replace = async (next: ExamDocument) => {
    try {
      if (manualRef.current) {
        setPage("assignments");
        throw new Error(
          "배정 조정에서 변경사항을 반영하거나 조정 취소한 뒤 다른 고사를 열어 주세요.",
        );
      }
      await save();
      worker.current?.terminate();
      setRunning(false);
      current.current = next;
      dirty.current = true;
      setD(next);
      setHistory([]);
      setFuture([]);
      await save();
      setPage("schedule");
    } catch (e) {
      notify(message(e));
    }
  };
  const undo = () => {
    const prev = history.at(-1);
    if (!prev) return;
    // Capture now: state updaters run later, after current.current changes.
    const now = current.current;
    setFuture((f) => [...f, now]);
    current.current = prev;
    markDirty();
    setD(prev);
    setHistory((h) => h.slice(0, -1));
  };
  const redo = () => {
    const next = future.at(-1);
    if (!next) return;
    const now = current.current;
    setHistory((h) => [...h, now]);
    current.current = next;
    markDirty();
    setD(next);
    setFuture((f) => f.slice(0, -1));
  };
  const keys = useRef({ undo, redo });
  keys.current = { undo, redo };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void save().catch((x) => notify(message(x)));
        return;
      }
      // Text fields keep their own native undo.
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        keys.current.undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        keys.current.redo();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [save, notify]);
  const start = () => {
    if (manualRef.current) {
      setPage("assignments");
      notify(
        "임시 조정을 먼저 반영하거나 취소한 뒤 자동 배정을 실행해 주세요.",
      );
      return;
    }
    const parsed = documentSchema.safeParse(d);
    if (!parsed.success) {
      notify(
        "입력을 확인해 주세요: " +
          parsed.error.issues
            .slice(0, 4)
            .map((x) => x.message)
            .join(", "),
      );
      return;
    }
    if (!d.teachers.length || !slotsFor(d).length) {
      notify("교사와 시험 과목·고사실을 먼저 등록해 주세요.");
      return;
    }
    if (dirty.current) void saveNow().catch(() => {});
    worker.current?.terminate();
    const w = new Worker(new URL("../solver.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    runInput.current = fingerprint(d);
    setRunning(true);
    setProgress(0);
    setPage("assignments");
    w.onmessage = (e) => {
      if (worker.current !== w) return;
      if (e.data.type === "progress") {
        setProgress(e.data.progress);
        return;
      }
      setRunning(false);
      w.terminate();
      worker.current = null;
      if (e.data.type === "error") {
        notify(e.data.message);
        return;
      }
      if (fingerprint(current.current) !== runInput.current) {
        notify(
          "계산 중 입력이 변경되어 결과를 적용하지 않았습니다. 다시 배정해 주세요.",
        );
        return;
      }
      edit(
        (x) => {
          x.result = e.data.result;
        },
        { persist: true },
      );
      notify("배정 계산을 마쳤습니다. 미배정과 경고를 확인해 주세요.");
    };
    w.onerror = (e) => {
      setRunning(false);
      w.terminate();
      worker.current = null;
      notify("계산 오류: " + e.message);
    };
    w.postMessage(parsed.data);
  };
  const cancel = () => {
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
    notify("계산을 취소했습니다. 이전 결과를 유지합니다.");
  };
  const doImport = async () => {
    if (!desktop) {
      notify("파일 기능은 데스크탑 앱에서 사용할 수 있습니다.");
      return;
    }
    try {
      const next = await desktop.importFile();
      if (next) await replace(next);
    } catch (e) {
      notify("불러오기 실패: " + message(e));
    }
  };
  const doExport = async () => {
    if (manualRef.current) {
      setPage("assignments");
      notify("임시 배정 조정을 반영한 뒤 내보내기 해주세요.");
      return;
    }
    if (!desktop)
      return notify("파일 기능은 데스크탑 앱에서 사용할 수 있습니다.");
    try {
      await save();
      if (await desktop.exportFile(documentSchema.parse(d)))
        notify("고사 파일을 내보냈습니다.");
    } catch (e) {
      notify(message(e));
    }
  };
  const requestNew = (next: () => ExamDocument, title: string) =>
    setConfirm({
      title,
      text: "현재 고사는 저장한 뒤 기록에 남깁니다.",
      run: () => {
        void replace(next());
      },
    });
  const slots = useMemo(() => slotsFor(d), [d]);
  const issues = useMemo(
    () => (d.result ? validate(d, d.result.assignments) : []),
    [d],
  );
  const stale = !!d.result && d.result.fingerprint !== fingerprint(d);
  const filled =
    d.result?.assignments.filter(
      (a) => a.teacherId && slots.some((s) => s.id === a.slotId),
    ).length ?? 0;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const group = groups.find((g) => g.pages.includes(page))!;
  return (
    <div className={`app page-${group.id} ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <LayoutGrid size={19} />
          </div>
          {!collapsed && <span>시험감독</span>}
        </div>
        <button
          className="new-exam"
          title="새 고사"
          onClick={() => requestNew(blank, "새 고사를 만들까요?")}
        >
          <Plus size={17} />
          {!collapsed && "새 고사"}
        </button>
        <div className="nav-label">{!collapsed ? "워크스페이스" : "　"}</div>
        <nav>
          {groups.map((n) => (
            <div className="nav-group" key={n.id}>
              <button
                key={n.id}
                className={n.pages.includes(page) ? "active" : ""}
                onClick={() => go(n.id)}
                title={n.label}
              >
                <n.icon size={18} />
                {!collapsed && (
                  <>
                    <span>{n.label}</span>
                    {n.id === "assignments" && d.result && (
                      <small>{warnings || <Check size={12} />}</small>
                    )}
                  </>
                )}
              </button>
              {!collapsed && tabs[n.id] && (
                <div className="nav-children">
                  {tabs[n.id]!.map((t) => (
                    <button
                      key={t.id}
                      aria-current={page === t.id ? "page" : undefined}
                      onClick={() => go(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        {!collapsed && (
          <div className="sidebar-note">
            <div className="tiny-dot" />내 컴퓨터에 안전하게
            <small>인터넷 연결 없이 사용할 수 있어요.</small>
          </div>
        )}
        <div className="sidebar-bottom">
          <button title="사이드바 접기" onClick={() => setCollapsed((x) => !x)}>
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
          {!collapsed && (
            <span>
              시험감독 <small>v1.1</small>
            </span>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            {d.title} <ChevronRight size={13} />
            <span>{group.label}</span>
          </div>
          <div className="top-actions">
            <span
              className={`save-state ${saveStatus.includes("실패") ? "bad" : ""}`}
            >
              <span className="tiny-dot" />
              {manualDraft ? "배정 조정 중 · 반영 전" : saveStatus}
            </span>
            <div className="history-buttons">
              <button
                title="되돌리기 (Ctrl+Z)"
                disabled={!history.length || running || !!manualDraft}
                onClick={undo}
              >
                <Undo2 size={15} />
                되돌리기
              </button>
              <button
                title="다시 실행 (Ctrl+Shift+Z)"
                disabled={!future.length || running || !!manualDraft}
                onClick={redo}
              >
                <Redo2 size={15} />
                다시 실행
              </button>
            </div>
            {saveStatus === "저장 안 됨" && !manualDraft && (
              <button
                className="primary save-button"
                title="저장 (Ctrl+S)"
                onClick={() => void saveNow().catch(() => {})}
              >
                저장
              </button>
            )}
            <button
              className="icon-btn"
              title="고사 파일 가져오기"
              onClick={() => void doImport()}
            >
              <Upload size={16} />
            </button>
            <button
              className="icon-btn"
              title="고사 파일 내보내기"
              onClick={() => void doExport()}
            >
              <Download size={16} />
            </button>
          </div>
        </header>
        {notice && (
          <div role="status" className="notice">
            <CircleHelp size={16} />
            <span>{notice}</span>
            <button title="알림 닫기" onClick={() => setNotice("")}>
              <X size={15} />
            </button>
          </div>
        )}
        <main>
          {/* Tabbed sections use the tab bar as their header to leave room for content. */}
          <div
            className={`page-heading ${tabs[group.id] && !running ? "tabbed" : ""}`}
          >
            <div>
              <h1>{group.label}</h1>
            </div>
            {page === "assignments" && !running && (
              <button
                className="ghost"
                disabled={!d.result}
                onClick={() => {
                  if (manualRef.current) {
                    notify("반영하지 않은 배정 조정을 먼저 반영하거나 취소해 주세요.");
                    return;
                  }
                  setExporting(true);
                }}
              >
                <FileSpreadsheet size={15} />
                엑셀로 내보내기
              </button>
            )}
            {(page === "assignments" || running) && (
              <button
                className="primary"
                disabled={!ready}
                onClick={running ? cancel : start}
              >
                {running ? <Square size={15} /> : <Play size={15} />}{" "}
                {running ? `계산 취소 · ${progress}%` : "자동 배정"}
                {!running && <ArrowUpRight size={15} />}
              </button>
            )}
          </div>
          {tabs[group.id] && (
            <div
              className="section-tabs"
              role="tablist"
              aria-label={group.label}
            >
              {tabs[group.id]!.map((t, i) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={page === t.id}
                  onClick={() => go(t.id)}
                >
                  <span className="tab-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {!ready ? (
            <div className="empty">고사를 불러오고 있습니다…</div>
          ) : (
            <>
              {page === "schedule" && (
                <Schedule
                  d={d}
                  edit={edit}
                  ask={setConfirm}
                  onSample={() =>
                    requestNew(() => sample(), "예시 고사를 열까요?")
                  }
                  onNext={() =>
                    void save()
                      .then(() => setPage("teachers"))
                      .catch((e) => notify(message(e)))
                  }
                />
              )}
              {page === "teachers" && (
                <Teachers
                  d={d}
                  edit={edit}
                  ask={setConfirm}
                  onNext={() =>
                    void save()
                      .then(() => setPage("availability"))
                      .catch((e) => notify(message(e)))
                  }
                />
              )}
              {(page === "availability" || page === "exclusions") && (
                <TeacherTimes
                  key={page}
                  d={d}
                  edit={edit}
                  step={page === "availability" ? "designated" : "blocked"}
                  notify={notify}
                  onNext={() =>
                    void save()
                      .then(() =>
                        setPage(
                          page === "availability" ? "exclusions" : "settings",
                        ),
                      )
                      .catch((e) => notify(message(e)))
                  }
                />
              )}
              {page === "settings" && (
                <Settings d={d} edit={edit} onRun={start} running={running} />
              )}
              {page === "assignments" && (
                <Assignments
                  d={d}
                  edit={edit}
                  stale={stale}
                  running={running}
                  progress={progress}
                  notify={notify}
                  draft={manualDraft}
                  setDraft={setManualDraft}
                />
              )}
              {page === "records" && (
                <Records
                  current={d}
                  saveStatus={saveStatus}
                  load={async (id) => {
                    try {
                      await save();
                      const data = await desktop!.load(id);
                      await replace(data.document);
                      if (data.recovered)
                        notify("직전 정상 백업에서 복구했습니다.");
                    } catch (e) {
                      notify(message(e));
                    }
                  }}
                  onImport={doImport}
                  onExport={doExport}
                  onNew={() => requestNew(blank, "새 고사를 만들까요?")}
                  onSample={() =>
                    requestNew(() => sample(), "예시 고사를 열까요?")
                  }
                  onLarge={() =>
                    requestNew(() => sample(true), "대규모 검증 고사를 열까요?")
                  }
                />
              )}
            </>
          )}
          <footer>
            시험감독 <span>·</span> 로컬 워크스페이스 <span>·</span>{" "}
            {d.settings.mode === "general" ? "일반 감독" : "정/부 감독"}
          </footer>
        </main>
      </div>
      {exporting && d.result && (
        <ExportDialog
          d={d}
          stale={stale}
          notify={notify}
          onClose={() => setExporting(false)}
        />
      )}
      {leave && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="저장하지 않은 변경사항"
            className="modal"
          >
            <h2>저장하지 않은 변경사항이 있습니다</h2>
            <p>
              저장하지 않고{" "}
              {leave === "close" ? "닫으면" : "이동하면"} 마지막으로 저장한
              상태로 돌아갑니다.
            </p>
            <div className="actions">
              <button autoFocus onClick={() => setLeave(null)}>
                취소
              </button>
              <button
                className="destructive"
                onClick={() => {
                  const target = leave;
                  setLeave(null);
                  discard();
                  if (target === "close") void desktop?.close();
                  else setPage(target);
                }}
              >
                저장하지 않고 {leave === "close" ? "닫기" : "이동"}
              </button>
              <button
                className="primary"
                onClick={() => {
                  const target = leave;
                  setLeave(null);
                  void saveNow()
                    .then(() => {
                      if (target === "close") void desktop?.close();
                      else setPage(target);
                    })
                    .catch(() => {});
                }}
              >
                저장하고 {leave === "close" ? "닫기" : "이동"}
              </button>
            </div>
          </section>
        </div>
      )}
      {confirm && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={confirm.title}
            className="modal"
          >
            <h2>{confirm.title}</h2>
            <p>{confirm.text}</p>
            <div className="actions">
              <button autoFocus onClick={() => setConfirm(null)}>
                취소
              </button>
              <button
                className="primary"
                onClick={() => {
                  const fn = confirm.run;
                  setConfirm(null);
                  fn();
                }}
              >
                확인
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

type Ask = (value: { title: string; text: string; run: () => void }) => void;
function Section({
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
    <section className="section">
      <div className="section-head">
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
function Empty({
  text,
  children,
}: {
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <LayoutGrid size={27} />
      <p>{text}</p>
      {children}
    </div>
  );
}
function Records({
  current,
  saveStatus,
  load,
  onImport,
  onExport,
  onNew,
  onSample,
  onLarge,
}: {
  current: ExamDocument;
  saveStatus: string;
  load: (id: string) => Promise<void>;
  onImport: () => Promise<void>;
  onExport: () => Promise<void>;
  onNew: () => void;
  onSample: () => void;
  onLarge: () => void;
}) {
  const [records, setRecords] = useState<RecordEntry[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    void desktop
      ?.list()
      .then(setRecords)
      .catch((e) => setError(message(e)));
  }, [current.updatedAt, saveStatus]);
  return (
    <>
      <div className="record-actions">
        <button onClick={onNew}>
          <Plus size={17} />새 고사
        </button>
        <button onClick={() => void onImport()}>
          <Upload size={17} />
          고사 파일 가져오기
        </button>
        <button onClick={() => void onExport()}>
          <Download size={17} />
          현재 고사 내보내기
        </button>
        <button onClick={onSample}>
          <FlaskConical size={17} />
          예시 고사
        </button>
      </div>
      <Section
        title="저장된 고사"
        description="입력한 내용은 이 컴퓨터에 자동 저장됩니다. 다른 PC로 옮길 때는 JSON 파일을 사용하세요."
      >
        {error && <div className="warning-box">{error}</div>}
        {!records.length ? (
          <Empty text="저장된 고사가 아직 없습니다." />
        ) : (
          <div className="record-list">
            {records.map((r) => (
              <button
                key={r.id}
                onClick={() => void load(r.id)}
                disabled={r.error}
              >
                <div className="record-icon">
                  <Archive size={20} />
                </div>
                <div>
                  <strong>{r.title}</strong>
                  <small>
                    {stamp(r.updatedAt)} · 교사 {r.teachers}명
                    {r.recovered ? " · 백업 복구 가능" : ""}
                  </small>
                </div>
                {r.id === current.id && <span className="tag">현재 고사</span>}
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        )}
      </Section>
      <div className="development-note">
        <span>성능 확인용 합성 데이터 · 100명 / 40실 / 5일 / 4교시</span>
        <button className="text-btn" onClick={onLarge}>
          대규모 예시 열기 <ArrowUpRight size={13} />
        </button>
      </div>
    </>
  );
}
