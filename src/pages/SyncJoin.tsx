import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { go } from "../lib/router";
import { isValidCode, normalizeCode } from "../sync/code";
import { joinSync, useSyncStatus } from "../sync/engine";
import { SYNC_ERRORS, goToday } from "../ui/SyncPanel";
import { SYNC_URL } from "../config";

/** Landing page of `#/sync?c=CODE` (the QR link). The code lives only in the hash fragment. */
export function SyncJoin({ code: fromUrl }: { code?: string }) {
  const st = useSyncStatus();
  const [code] = useState(() => (fromUrl ? normalizeCode(fromUrl) : ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const leave = () => {
    window.clearTimeout(timer.current);
    goToday(); // replaces the URL, so the code does not stay in history
  };
  const join = async () => {
    setBusy(true);
    setErr(null);
    const r = await joinSync(code);
    setBusy(false);
    if (!r.ok) return setErr(SYNC_ERRORS[r.error]);
    setDone(true);
    history.replaceState(null, "", "#/sync");
    timer.current = window.setTimeout(leave, 1400);
  };

  const same = st.enabled && st.code === code;
  const other = st.enabled && !same;
  const bad = !SYNC_URL ? "Bu sürümde eşitleme kapalı." : !code ? "Eşitleme kodu bulunamadı. Kodu Profil → Cihazlarımı eşitle bölümüne yazabilirsin." : !isValidCode(code) ? SYNC_ERRORS["invalid-code"] : null;

  return (
    <div className="page sync-join">
      <section className="panel sync-join-card">
        {done ? (
          <>
            <p className="sync-done" role="status">
              <Check size={22} /> Bu cihaz eşitlendi ✓
            </p>
            <button className="btn btn-primary" onClick={leave}>
              Bugüne git
            </button>
          </>
        ) : bad ? (
          <>
            <h1 className="sync-join-title">Eşitleme</h1>
            <p className="warn-text">{bad}</p>
            <div className="data-actions">
              <button className="btn btn-primary" onClick={() => go({ page: "me" }, null, true)}>
                Profile git
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="sync-join-title">Bu cihazı eşitlemeye bağla?</h1>
            <p className="muted">Bu cihazdaki ilerleme kaybolmaz; iki cihazınki birleştirilir.</p>
            {same && <p className="muted">Bu cihaz zaten bu kodla eşitleniyor.</p>}
            {other && <p className="warn-text">Bu cihaz şu an başka bir kodla eşitleniyor. Bağlarsan o eşitleme bu cihazda sona erer (verisi sunucuda kalır).</p>}
            {err && (
              <p className="warn-text" role="alert">
                {err}
              </p>
            )}
            <div className="data-actions">
              {same ? (
                <button className="btn btn-primary" onClick={leave}>
                  Bugüne git
                </button>
              ) : (
                <button className="btn btn-primary" onClick={join} disabled={busy}>
                  {other ? "Geçiş yap" : "Bağla"}
                </button>
              )}
              <button className="btn btn-ghost" onClick={leave}>
                Vazgeç
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
