import React, { useEffect, useMemo, useRef, useState } from "react";
// write-excel-file is lazy-loaded only when the user clicks Export Excel
// to keep it out of the initial bundle (~50 KB saved on first load).
import {
  Chart,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  CategoryScale, LinearScale,
  Tooltip, Legend,
} from "chart.js";

Chart.register(
  BarController, BarElement,
  LineController, LineElement, PointElement,
  CategoryScale, LinearScale,
  Tooltip, Legend,
);
import {
  Upload, Shield, Download, Trash2, Sparkles,
  Search, Lock, Unlock, FileSpreadsheet, CalendarRange, BarChart3
} from "lucide-react";

const MAX_PREVIEW_ROWS = 200;

const APP_TITLE = import.meta.env.VITE_APP_TITLE || "PandaHistoryAnalitic";
// If VITE_APP_PASSWORD is not set, the gate is disabled (auto-unlock).
// Never rely on this as real auth — password is baked into the JS bundle.
const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD
  ? String(import.meta.env.VITE_APP_PASSWORD)
  : null;
const AUTH_KEY = "panda_auth_ok";
const THEME_KEY = "panda_theme";

function applyTheme(theme){
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  document.body?.setAttribute("data-theme", t);
  document.documentElement.classList.toggle("is-light", t === "light");
}

function animateThemeChange(){
  document.documentElement.classList.add("theme-anim");
  window.setTimeout(() => document.documentElement.classList.remove("theme-anim"), 380);
}


function formatDateForCsv(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return iso;
  }
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsvWithBom(rows) {
  const escape = (v) => {
    let s = String(v ?? "");
    // Prevent formula injection: prefix dangerous leading chars with a tab
    if (/^[=+\-@]/.test(s)) s = "\t" + s;
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = rows.map(r => r.map(escape).join(",")).join("\r\n");
  return "\ufeff" + csv;
}

function buildDomainStats(urls) {
  const map = new Map();
  for (const u of urls) {
    const host = getDomain(u);
    if (!host) continue;
    map.set(host, (map.get(host) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
}

function aggregate(records, dedupeMode, dateMode) {
  // key -> { minIso, maxIso }
  const map = new Map();
  for (const r of records) {
    const key = dedupeMode === "domain" ? r.domain : r.url;
    if (!key) continue;
    const iso = r.iso || "";
    const ex = map.get(key);
    if (!ex) {
      map.set(key, { minIso: iso || "", maxIso: iso || "" });
      continue;
    }
    if (iso) {
      if (!ex.minIso || iso < ex.minIso) ex.minIso = iso;
      if (!ex.maxIso || iso > ex.maxIso) ex.maxIso = iso;
    }
  }
  const out = [...map.entries()].map(([key, v]) => ({
    key,
    value: key,
    dateIso: dateMode === "first" ? (v.minIso || "") : (v.maxIso || "")
  }));
  out.sort((a, b) => a.value.localeCompare(b.value));
  return out;
}

function isoToYearMonth(iso) {
  if (!iso) return { year: "", month: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { year: "", month: "" };
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return { year, month };
}

function computeTimeStats(records) {
  // Based on raw records (before dedupe), because it reflects real activity.
  const byYear = new Map();     // year -> count
  const byYearMonth = new Map(); // "YYYY-MM" -> count

  for (const r of records) {
    if (!r.iso) continue;
    const { year, month } = isoToYearMonth(r.iso);
    if (!year) continue;
    byYear.set(year, (byYear.get(year) || 0) + 1);
    const ym = `${year}-${month}`;
    byYearMonth.set(ym, (byYearMonth.get(ym) || 0) + 1);
  }

  const years = [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const months = [...byYearMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return { years, months };
}

function buildMonthsForYear(monthEntries, year) {
  // returns 12 months
  const map = new Map(monthEntries); // ym -> count
  const labels = [];
  const values = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    labels.push(`${year}-${mm}`);
    values.push(map.get(`${year}-${mm}`) || 0);
  }
  return { labels, values };
}

function safeBaseName(fileName) {
  return (fileName || "export")
    .replace(/\.[^.]+$/, "")          // strip extension
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") // strip chars illegal in filenames
    .replace(/^\.+/, "_")             // no leading dots (hidden files)
    .slice(0, 200)                    // cap length
    || "export";
}

function PasswordGate({ onUnlock }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");

  function submit() {
    if (!APP_PASSWORD) { onUnlock(); return; } // gate disabled
    const ok = val === APP_PASSWORD;
    if (!ok) {
      setErr("סיסמה שגויה.");
      return;
    }
    sessionStorage.setItem(AUTH_KEY, "1");
    onUnlock();
  }

  return (
    <div className="modalOverlay">
      <div className="modal">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Lock size={18} /> הגנה בסיסית — הזן סיסמה
        </h2>
        <p>
          זו שכבת הגנה בסיסית בצד לקוח (לא תחליף לאימות שרת). מתאימה להגנה “קלה” על כלי פרטי שמריצים ב-Vercel.
        </p>

        <div className="row">
          <input
            className="input"
            style={{ flex: 1, minWidth: 220 }}
            type="password"
            placeholder="סיסמה"
            value={val}
            onChange={(e) => { setVal(e.target.value); setErr(""); }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button className="btn primary" onClick={submit}>
            <Unlock size={16} style={{ marginLeft: 8 }} /> כניסה
          </button>
        </div>

        {err && <div className="small err" style={{ marginTop: 10 }}>{err}</div>}
        <div className="small" style={{ marginTop: 10 }}>
          שינוי סיסמה: ב-Vercel → Settings → Environment Variables → <span className="kbd">VITE_APP_PASSWORD</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() =>
    !APP_PASSWORD || sessionStorage.getItem(AUTH_KEY) === "1"
  );
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "dark");
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [canInstall, setCanInstall] = useState(false);

  // Persist and apply theme whenever it changes
  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

  // Capture PWA install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const [fileName, setFileName] = useState("");
  const [dateMode, setDateMode] = useState("first"); // first | last
  const [dedupeMode, setDedupeMode] = useState("url"); // url | domain
  const [status, setStatus] = useState({ kind: "idle", msg: "" });

  const [records, setRecords] = useState([]); // raw extracted: {url, domain, iso}
  const [meta, setMeta] = useState(null);
  const [previewCount, setPreviewCount] = useState(MAX_PREVIEW_ROWS);

  // Table search & filters
  const [searchText, setSearchText] = useState("");
  const [yearFilter, setYearFilter] = useState("all"); // for table, based on selected item's date
  const [monthFilter, setMonthFilter] = useState("all"); // 01-12

  // Derived
  const results = useMemo(() => aggregate(records, dedupeMode, dateMode), [records, dedupeMode, dateMode]);
  const domainTop10 = useMemo(() => buildDomainStats(records.map(r => r.url)), [records]);
  const timeStats = useMemo(() => computeTimeStats(records), [records]);

  const availableYears = useMemo(() => {
    const years = timeStats.years.map(([y]) => y);
    return years;
  }, [timeStats]);

  const selectedYearForChart = useMemo(() => {
    // for chart we pick last year by default
    if (availableYears.length === 0) return "";
    return availableYears[availableYears.length - 1];
  }, [availableYears]);

  // Filter results for table (after aggregation)
  const filteredResults = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const wantYear = yearFilter !== "all" ? yearFilter : "";
    const wantMonth = monthFilter !== "all" ? monthFilter : "";

    return results.filter((r) => {
      if (q) {
        if (!String(r.value).toLowerCase().includes(q)) return false;
      }
      if (wantYear || wantMonth) {
        const { year, month } = isoToYearMonth(r.dateIso);
        if (wantYear && year !== wantYear) return false;
        if (wantMonth && month !== wantMonth) return false;
      }
      return true;
    });
  }, [results, searchText, yearFilter, monthFilter]);

  // Active file-processing worker (terminate on new upload or unmount)
  const workerRef = useRef(null);
  useEffect(() => () => workerRef.current?.terminate(), []);

  // Charts
  const chartDomainRef = useRef(null);
  const canvasDomainRef = useRef(null);

  const chartYearsRef = useRef(null);
  const canvasYearsRef = useRef(null);

  const chartMonthsRef = useRef(null);
  const canvasMonthsRef = useRef(null);

  useEffect(() => {
    // Domain chart
    if (!canvasDomainRef.current) return;
    if (chartDomainRef.current) { chartDomainRef.current.destroy(); chartDomainRef.current = null; }
    if (!domainTop10.length) return;

    const ctx = canvasDomainRef.current.getContext("2d");
    chartDomainRef.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels: domainTop10.map(([d]) => d),
        datasets: [{ label: "כמות כתובות (לפני ייחודיות)", data: domainTop10.map(([, c]) => c) }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true }, tooltip: { enabled: true } }
      }
    });

    return () => {
      if (chartDomainRef.current) chartDomainRef.current.destroy();
      chartDomainRef.current = null;
    };
  }, [domainTop10]);

  useEffect(() => {
    // Years chart
    if (!canvasYearsRef.current) return;
    if (chartYearsRef.current) { chartYearsRef.current.destroy(); chartYearsRef.current = null; }
    if (!timeStats.years.length) return;

    const ctx = canvasYearsRef.current.getContext("2d");
    chartYearsRef.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels: timeStats.years.map(([y]) => y),
        datasets: [{ label: "כמות ביקורים לפי שנה (נתונים גולמיים)", data: timeStats.years.map(([, c]) => c) }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true }, tooltip: { enabled: true } }
      }
    });

    return () => {
      if (chartYearsRef.current) chartYearsRef.current.destroy();
      chartYearsRef.current = null;
    };
  }, [timeStats]);

  useEffect(() => {
    // Months chart for last year (auto)
    if (!canvasMonthsRef.current) return;
    if (chartMonthsRef.current) { chartMonthsRef.current.destroy(); chartMonthsRef.current = null; }
    if (!selectedYearForChart || !timeStats.months.length) return;

    const { labels, values } = buildMonthsForYear(timeStats.months, selectedYearForChart);

    const ctx = canvasMonthsRef.current.getContext("2d");
    chartMonthsRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{ label: `ביקורים לפי חודש (${selectedYearForChart})`, data: values, tension: 0.25 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true }, tooltip: { enabled: true } }
      }
    });

    return () => {
      if (chartMonthsRef.current) chartMonthsRef.current.destroy();
      chartMonthsRef.current = null;
    };
  }, [timeStats, selectedYearForChart]);

  function handleFile(file) {
    if (!file) return;

    // Terminate any in-progress worker before starting a new one
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    setFileName(file.name);
    setStatus({ kind: "loading", msg: "קורא את הקובץ ומנתח נתונים..." });
    setRecords([]);
    setMeta(null);

    const worker = new Worker(new URL("./fileWorker.js", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      workerRef.current = null;
      worker.terminate();
      const { type, records: extracted, meta, message } = e.data;
      if (type === "error") {
        setStatus({ kind: "error", msg: message });
        return;
      }
      setRecords(extracted);
      setMeta(meta);
      setStatus({ kind: "ok", msg: `הושלם! נטענו ${extracted.length.toLocaleString()} רשומות.` });
    };

    worker.onerror = (err) => {
      workerRef.current = null;
      worker.terminate();
      setStatus({ kind: "error", msg: err?.message || "שגיאה לא צפויה" });
    };

    worker.postMessage({ file });
  }

  function onDrop(e) { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }
  function onPick() { document.getElementById("fileInput")?.click(); }

  function resetAll() {
    setFileName("");
    setRecords([]);
    setMeta(null);
    setStatus({ kind: "idle", msg: "" });
    setSearchText("");
    setYearFilter("all");
    setMonthFilter("all");
    const el = document.getElementById("fileInput");
    if (el) el.value = "";
  }

  function exportCsv() {
    const col1 = dedupeMode === "domain" ? "Domain" : "URL";
    const rows = [[col1, "תאריך"], ...filteredResults.map(r => [r.value, formatDateForCsv(r.dateIso)])];
    const csv = toCsvWithBom(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(`${safeBaseName(fileName)}_${dedupeMode === "domain" ? "unique_domains" : "unique_urls"}.csv`, blob);
  }

  async function exportXlsx() {
    try {
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      const col1 = dedupeMode === "domain" ? "Domain" : "URL";
      const data = [
        [col1, "תאריך (ISO)", "תאריך (תצוגה)"],
        ...filteredResults.map(r => [r.value, r.dateIso || "", formatDateForCsv(r.dateIso)])
      ];
      const blob = await writeXlsxFile(data);
      downloadBlob(`${safeBaseName(fileName)}_${dedupeMode === "domain" ? "unique_domains" : "unique_urls"}.xlsx`, blob);
    } catch (e) {
      setStatus({ kind: "error", msg: `שגיאה בייצוא Excel: ${e?.message || "שגיאה לא צפויה"}` });
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(filteredResults, null, 2)], { type: "application/json;charset=utf-8" });
    downloadBlob(`${safeBaseName(fileName)}_${dedupeMode === "domain" ? "unique_domains" : "unique_urls"}.json`, blob);
  }

async function installPwa() {
  if (!deferredPrompt) {
    alert(
`התקנה ידנית:

בכרום (מחשב):
1. לחץ על ⋮
2. בחר "התקן PandaHistoryAnalitic"

בכרום אנדרואיד:
1. ⋮
2. הוסף למסך הבית

ב־Safari iPhone:
1. כפתור שיתוף
2. הוסף למסך הבית`
    );
    return;
  }
  try {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setCanInstall(false);
    setStatus((s) => s.kind === "loading" ? s : { kind: "ok", msg: choice?.outcome === "accepted" ? "האפליקציה הותקנה ✅" : "התקנה בוטלה" });
  } catch {
    setStatus({ kind: "error", msg: "לא ניתן להציג חלון התקנה כרגע." });
  }
}


  function logout() {
    sessionStorage.removeItem(AUTH_KEY);
    setAuthed(false);
  }

  if (!authed) {
    return <PasswordGate onUnlock={() => setAuthed(true)} />;
  }

  return (
    <div className="container">
      {/* Header */}
      <div className="header">
        <div className="brand">
          <div className="brandLogo" title="Panda">
            <span style={{ fontSize: 22 }}>🐼</span>
          </div>
          <div className="brandTitle">
            <h1>{APP_TITLE}</h1>
            <p>Local • Private • Panda-branded</p>
          </div>
        </div>

        <div className="badges">
          <span className="badge"><Shield size={14} /> עיבוד מקומי בלבד</span>
          <span className="badge"><Lock size={14} /> Password Gate</span>
          <button
            className="btn"
            onClick={() => { animateThemeChange(); setTheme((t) => (t === "dark" ? "light" : "dark")); }}
            title="מעבר מצב תצוגה"
          >
            {theme === "dark" ? "☀️ מצב אור" : "🌙 מצב כהה"}
          </button>
          <button className="btn primary installBtn" onClick={installPwa} title="התקן כאפליקציה (PWA)">
              <Download size={16} style={{ marginLeft: 8 }} /> {canInstall ? "התקן אפליקציה" : "התקנה ידנית"}
            </button>
          <button className="btn danger" onClick={logout} title="התנתק">
            <Unlock size={16} style={{ marginLeft: 8 }} /> התנתק
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="badge"><FileSpreadsheet size={14} /> CSV / XLSX</span>
          <span className="badge"><CalendarRange size={14} /> ביקור ראשון/אחרון</span>
          <span className="badge"><BarChart3 size={14} /> סטטיסטיקות שנה/חודש</span>
        </div>

        <div className="row">
          <button className="btn primary" onClick={onPick}>
            <Upload size={16} style={{ marginLeft: 8 }} /> העלאת קובץ
          </button>

          <label className="badge" style={{ gap: 8 }}>
            ייחודיות לפי:
            <select className="select" value={dedupeMode} onChange={(e) => setDedupeMode(e.target.value)}>
              <option value="url">URL מלא</option>
              <option value="domain">דומיין בלבד</option>
            </select>
          </label>

          <label className="badge" style={{ gap: 8 }}>
            תאריך לשמור:
            <select className="select" value={dateMode} onChange={(e) => setDateMode(e.target.value)}>
              <option value="first">ביקור ראשון</option>
              <option value="last">ביקור אחרון</option>
            </select>
          </label>

          <span className="badge">
            מגבלת תצוגה:
            <input
              className="input"
              style={{ width: 110, marginRight: 8, minWidth: 110 }}
              type="number"
              min="50"
              max="5000"
              value={previewCount}
              onChange={(e) => setPreviewCount(Math.max(50, Math.min(5000, Number(e.target.value) || MAX_PREVIEW_ROWS)))}
            />
            שורות
          </span>

          {filteredResults.length > 0 && (
            <>
              <button className="btn good" onClick={exportXlsx}>
                <Download size={16} style={{ marginLeft: 8 }} /> ייצוא Excel
              </button>
              <button className="btn" onClick={exportCsv}>
                <Download size={16} style={{ marginLeft: 8 }} /> ייצוא CSV
              </button>
              <button className="btn" onClick={exportJson}>
                <Download size={16} style={{ marginLeft: 8 }} /> ייצוא JSON
              </button>
              <button className="btn danger" onClick={resetAll}>
                <Trash2 size={16} style={{ marginLeft: 8 }} /> ניקוי
              </button>
            </>
          )}
        </div>

        <div
          className="drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick()}
        >
          <div>
            <strong>גרור לכאן קובץ או לחץ להעלאה</strong>
            <div className="small">
              פורמטים נתמכים: <span className="kbd">.csv</span> <span className="kbd">.xlsx</span>
            </div>
          </div>
          <div className="kbd">Drop</div>
        </div>

        <input
          id="fileInput"
          type="file"
          accept=".csv,.xlsx"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        <div className="hr" />

        {/* Status + Meta */}
        {fileName && (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="badge">קובץ: <strong style={{ color: "var(--text)" }}>{fileName}</strong></span>
            <span className={"badge " + (status.kind === "ok" ? "ok" : status.kind === "error" ? "err" : "")}>
              {status.kind === "loading" ? "⏳ " : status.kind === "ok" ? "✅ " : status.kind === "error" ? "⚠️ " : "ℹ️ "}
              {status.msg || "מוכן."}
            </span>
          </div>
        )}

        {meta && (
          <div className="small" style={{ marginTop: 10 }}>
            <div>
              שורת כותרות: {meta.headerRowIndex + 1} | URLs נסרקו: {meta.scannedUrls.toLocaleString()} | נפסלו: {meta.invalidUrls.toLocaleString()} | רשומות: {meta.records.toLocaleString()}
            </div>
            <div>
              עמודת URL: {meta.urlCol == null ? "סריקה אוטומטית בכל שורה" : `${meta.urlCol + 1} (${String(meta.headers[meta.urlCol] ?? "").trim() || "ללא שם"})`} |
              עמודת תאריך: {meta.dateCol == null ? "סריקה חכמה בשורה / לא נמצאה כותרת ברורה" : `${meta.dateCol + 1} (${String(meta.headers[meta.dateCol] ?? "").trim() || "ללא שם"})`}
            </div>
          </div>
        )}
      </div>

      {/* Search + Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginTop: 0 }}>
          <span className="badge"><Search size={14} /> חיפוש וסינון</span>
          <input
            className="input"
            placeholder={dedupeMode === "domain" ? "חפש דומיין..." : "חפש URL..."}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <label className="badge" style={{ gap: 8 }}>
            שנה:
            <select className="select" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
              <option value="all">הכל</option>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="badge" style={{ gap: 8 }}>
            חודש:
            <select className="select" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
              <option value="all">הכל</option>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>

          <span className="badge">
            תוצאות אחרי פילטר: <strong style={{ color: "var(--text)" }}>{filteredResults.length.toLocaleString()}</strong>
          </span>
        </div>

        <div className="small" style={{ marginTop: 10 }}>
          טיפ: הייצוא (CSV/XLSX/JSON) מייצא את <strong style={{ color: "var(--text)" }}>התוצאות המסוננות</strong> בדיוק כמו שאתה רואה.
        </div>
      </div>

      {/* Main */}
      <div className="grid">
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="badge"><Sparkles size={14} /> טבלה</span>
            <span className="badge">מוצגות עד {Math.min(previewCount, filteredResults.length).toLocaleString()} שורות</span>
          </div>

          {filteredResults.length === 0 ? (
            <p className="small" style={{ marginTop: 12 }}>
              העלה קובץ כדי לראות תוצאות. לאחר מכן תוכל לחפש/לסנן/לייצא ל-CSV או Excel.
            </p>
          ) : (
            <div className="tableWrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "62%" }}>{dedupeMode === "domain" ? "Domain" : "URL"}</th>
                    <th>תאריך</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.slice(0, previewCount).map((r) => (
                    <tr key={r.key}>
                      <td style={{ wordBreak: "break-all" }}>
                        <a
                          href={dedupeMode === "domain" ? `https://${r.value}` : r.value}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--accent)", textDecoration: "underline" }}
                        >
                          {r.value}
                        </a>
                      </td>
                      <td>{formatDateForCsv(r.dateIso) || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filteredResults.length > previewCount && (
            <div className="small" style={{ marginTop: 10 }}>
              מוצגות {previewCount.toLocaleString()} מתוך {filteredResults.length.toLocaleString()}.
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <div className="card">
            <div className="badge"><BarChart3 size={14} /> Top 10 דומיינים</div>
            {domainTop10.length === 0 ? (
              <p className="small" style={{ marginTop: 10 }}>אחרי טעינת קובץ תראה כאן את 10 הדומיינים המובילים.</p>
            ) : (
              <canvas ref={canvasDomainRef} height="240" style={{ marginTop: 10 }} />
            )}
          </div>

          <div className="card">
            <div className="badge"><BarChart3 size={14} /> סטטיסטיקות לפי שנה</div>
            {!timeStats.years.length ? (
              <p className="small" style={{ marginTop: 10 }}>צריך תאריכים בקובץ כדי להציג סטטיסטיקות.</p>
            ) : (
              <canvas ref={canvasYearsRef} height="210" style={{ marginTop: 10 }} />
            )}
          </div>

          <div className="card">
            <div className="badge"><CalendarRange size={14} /> לפי חודש (שנה אחרונה בקובץ)</div>
            {!timeStats.months.length ? (
              <p className="small" style={{ marginTop: 10 }}>צריך תאריכים בקובץ כדי להציג סטטיסטיקות.</p>
            ) : (
              <>
                <div className="small" style={{ marginTop: 8 }}>
                  שנה מוצגת: <strong style={{ color: "var(--text)" }}>{selectedYearForChart || "-"}</strong>
                </div>
                <canvas ref={canvasMonthsRef} height="210" style={{ marginTop: 10 }} />
              </>
            )}
          </div>
        </div>
      </div>



{/* Corner Panda */}
<button
  className="cornerPanda"
  title="Panda • חזרה למעלה"
  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
>
  🐼
</button>

      <div className="small" style={{ marginTop: 14, opacity: 0.95 }}>
        פרטיות: כל קריאת הקובץ, חילוץ, ניתוח, סינון וייצוא מתבצעים מקומית בדפדפן. הגנת הסיסמה כאן בסיסית (Client-Side Gate).
      </div>
    </div>
  );
}
