import { Check, Copy, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SYNC_URL } from "../config";
import { go } from "../lib/router";
import { createSync, deleteSyncFromServer, disableSync, joinSync, syncNow, useSyncStatus, type SyncError } from "../sync/engine";
import { Sheet } from "./Sheet";
import { toast } from "./Toast";

export const SYNC_ERRORS: Record<SyncError, string> = {
  offline: "Çevrimdışı, bağlantı gelince eşitlenecek",
  server: "Sunucuya ulaşılamadı, tekrar denenecek",
  removed: "Bu eşitleme kodu artık geçerli değil",
  "not-found": "Bu kod bulunamadı",
  "invalid-code": "Kod geçerli görünmüyor; kelimeleri ve sayıyı kontrol et",
  "too-large": "İlerleme çok büyük",
};

/** "az önce", "3 dk önce", "2 sa önce", "dün", "4 gün önce". */
export function relTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "az önce";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.floor(h / 24);
  return d === 1 ? "dün" : `${d} gün önce`;
}

export const joinLink = (code: string) => `${location.origin}${import.meta.env.BASE_URL}#/sync?c=${code}`;

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

export function SyncPanel() {
  const st = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [qr, setQr] = useState(false);
  useTick(30_000);
  if (!SYNC_URL) return null;

  const fail = (e: SyncError) => setErr(SYNC_ERRORS[e]);
  const enable = async () => {
    setBusy(true);
    setErr(null);
    const r = await createSync();
    setBusy(false);
    if (!r.ok) return fail(r.error);
    toast("Eşitleme açıldı", "ok");
    setQr(true);
  };
  const connect = async () => {
    setBusy(true);
    setErr(null);
    const r = await joinSync(code);
    setBusy(false);
    if (!r.ok) return fail(r.error);
    setJoining(false);
    setCode("");
    toast("Bu cihaz eşitlendi ✓", "ok");
  };
  const turnOff = () => {
    if (confirm("Bu cihazda eşitleme kapatılsın mı? İlerlemen bu cihazda kalır; diğer cihazlar eşitlemeye devam eder.")) {
      disableSync();
      setQr(false);
    }
  };
  const wipe = async () => {
    if (!confirm("Eşitleme verisi sunucudan silinsin mi?\n\nDiğer cihazlar eşitlemeyi bırakır ama kendi ilerlemelerini korur. Bu işlem geri alınamaz.")) return;
    setBusy(true);
    const r = await deleteSyncFromServer();
    setBusy(false);
    if (!r.ok) return fail(r.error ?? "server");
    setQr(false);
    toast("Eşitleme verisi sunucudan silindi");
  };

  const status = st.syncing ? "Eşitleniyor…" : st.error ? SYNC_ERRORS[st.error] : `Eşitleme açık${st.lastSync ? ` · Son eşitleme: ${relTime(st.lastSync)}` : ""}`;

  return (
    <section className="panel sync-panel" aria-labelledby="sync-h">
      <h3 className="eyebrow" id="sync-h">
        Cihazlarımı eşitle
      </h3>
      {!st.enabled ? (
        <>
          <p className="muted">İlerlemeni telefonun ve bilgisayarın arasında otomatik eşitle. Hesap gerekmez; veriler cihazında şifrelenir.</p>
          <div className="data-actions">
            <button className="btn btn-primary" onClick={enable} disabled={busy}>
              <RefreshCw size={18} /> Eşitlemeyi aç
            </button>
            <button className="btn btn-ghost" onClick={() => setJoining((v) => !v)} aria-expanded={joining}>
              <Smartphone size={18} /> Başka cihazdaki kodu gir
            </button>
          </div>
          {joining && (
            <form
              className="sync-join-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim() && !busy) void connect();
              }}
            >
              <input className="sync-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="river-lamp-green-cloud-4821" aria-label="Eşitleme kodu" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus />
              <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()}>
                Bağlan
              </button>
            </form>
          )}
        </>
      ) : (
        <>
          <p className={`sync-status ${st.error && st.error !== "offline" ? "is-bad" : ""}`} role="status">
            <span className="sync-dot" aria-hidden="true" />
            {status}
          </p>
          <div className="data-actions">
            <button className="btn btn-primary" onClick={() => void syncNow()} disabled={st.syncing}>
              <RefreshCw size={18} className={st.syncing ? "spin" : ""} /> Şimdi eşitle
            </button>
            <button className="btn btn-ghost" onClick={() => setQr(true)}>
              <QrCode size={18} /> Başka cihaz ekle
            </button>
            <button className="btn btn-ghost" onClick={turnOff}>
              Bu cihazda kapat
            </button>
          </div>
          <p className="sync-danger-row">
            <button className="sync-danger" onClick={wipe} disabled={busy}>
              Eşitleme verisini sunucudan sil
            </button>
          </p>
        </>
      )}
      {err && (
        <p className="warn-text" role="alert">
          {err}
        </p>
      )}
      {createPortal(<QrSheet open={qr && !!st.code} code={st.code ?? ""} onClose={() => setQr(false)} />, document.body)}
    </section>
  );
}

function QrSheet({ open, code, onClose }: { open: boolean; code: string; onClose: () => void }) {
  const [svg, setSvg] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!open || !code) return;
    let live = true;
    import("qrcode").then((Q) => Q.toString(joinLink(code), { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1a2035", light: "#ffffff" } })).then((s) => live && setSvg(s), () => null);
    return () => {
      live = false;
    };
  }, [open, code]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Kopyalanamadı; kodu elle yazabilirsin", "warn");
    }
  };
  return (
    <Sheet open={open} onClose={onClose} label="Başka cihaz ekle" className="sync-sheet">
      <h2 className="sync-sheet-title">Başka cihaz ekle</h2>
      <div className="qr-tile" role="img" aria-label="Eşitleme QR kodu" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="sync-code-row">
        <code className="sync-code" data-testid="sync-code">
          {code}
        </code>
        <button className="icon-btn" onClick={copy} aria-label="Kodu kopyala" title="Kodu kopyala">
          {copied ? <Check size={19} /> : <Copy size={19} />}
        </button>
      </div>
      <p className="muted sync-hint">Diğer cihazın kamerasıyla QR'ı okut ya da kodu Profil → Cihazlarımı eşitle bölümüne yaz.</p>
    </Sheet>
  );
}

export function goToday() {
  go({ page: "today" }, null, true);
}
