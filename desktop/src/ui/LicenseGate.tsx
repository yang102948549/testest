import { useEffect, useState, type ReactNode } from "react";
import { desktop } from "../bridge";

export function LicenseGate({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(!desktop);
  const [loading, setLoading] = useState(!!desktop);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    desktop
      ?.licenseStatus()
      .then((s) => {
        if (live) {
          setActive(s.active);
          setLoading(false);
        }
      })
      .catch(() => {
        if (live) {
          setError("인증 정보를 확인하지 못했습니다. 다시 실행해 주세요.");
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!active)
      return desktop?.onClosing(() => {
        void desktop?.close();
      });
  }, [active]);
  if (active) return children;
  return (
    <main className="license-screen">
      <section className="license-card">
        <div className="license-mark">YY</div>
        <h1>Oni 감독</h1>
        <p className="license-author">제작자 Oniabey</p>
        <h2>CD키 인증</h2>
        <p>
          구매 시 전달받은 인증키 전체를 붙여넣어 주세요. 인터넷 연결 없이
          인증합니다.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!desktop) return;
            setLoading(true);
            setError("");
            try {
              const s = await desktop.activateLicense(token);
              setActive(s.active);
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message.replace(
                      /^Error invoking remote method '[^']+': (Error: )?/,
                      "",
                    )
                  : "인증에 실패했습니다.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          <label htmlFor="license-key">인증키 (CD키)</label>
          <textarea
            id="license-key"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            maxLength={4096}
            rows={5}
            disabled={loading}
          />
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <button
            className="primary"
            type="submit"
            disabled={loading || !token.trim()}
          >
            {loading ? "인증 확인 중…" : "인증하고 시작"}
          </button>
        </form>
        <p className="license-help">키 분실·인증 문의: 제작자 Oniabey</p>
      </section>
    </main>
  );
}
