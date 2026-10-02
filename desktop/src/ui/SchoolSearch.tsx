import { useState } from "react";
import { desktop } from "../bridge";
import type { ComciganSchool } from "../domain/timetable";

const SCHOOL_KEY = "comcigan-school";
/** Last school used on this computer: only a search-box convenience. */
export const lastSchool = (): ComciganSchool | null => {
  try {
    return JSON.parse(localStorage.getItem(SCHOOL_KEY) ?? "null");
  } catch {
    return null;
  }
};
export const rememberSchool = (s: ComciganSchool) => {
  try {
    localStorage.setItem(SCHOOL_KEY, JSON.stringify(s));
  } catch {
    /* per-viewer convenience only */
  }
};
export const cleanError = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );

/** Comcigan school search box with a result list. */
export function SchoolSearch({
  selected,
  disabled,
  onPick,
}: {
  selected?: number;
  disabled?: boolean;
  onPick: (school: ComciganSchool) => void;
}) {
  const [query, setQuery] = useState(lastSchool()?.name ?? ""),
    [schools, setSchools] = useState<ComciganSchool[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const search = async () => {
    setError("");
    setBusy(true);
    try {
      if (!desktop?.searchSchools)
        throw new Error("앱이 업데이트되었습니다. 앱을 닫고 다시 실행해 주세요.");
      const found = await desktop.searchSchools(query);
      setSchools(found);
      if (!found.length)
        setError("검색된 학교가 없습니다. 이름을 줄여서 검색해 보세요.");
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="school-search">
      <form
        className="link-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim().length >= 2) void search();
        }}
      >
        <input
          aria-label="학교 이름"
          placeholder="학교 이름 (예: 한국고)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          className="primary"
          disabled={query.trim().length < 2 || busy || disabled}
        >
          {busy ? "검색 중…" : "검색"}
        </button>
      </form>
      {!!schools?.length && (
        <div className="school-list" role="list">
          {schools.map((s) => (
            <button
              key={s.code}
              role="listitem"
              className={selected === s.code ? "selected" : ""}
              disabled={disabled}
              onClick={() => onPick(s)}
            >
              <b>{s.name}</b>
              <small>{s.region}</small>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
