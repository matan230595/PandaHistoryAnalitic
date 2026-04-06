// Web Worker: handles all file parsing off the main thread to prevent UI freeze.
// Receives: { file: File }
// Posts back: { type: "done", records, meta } | { type: "error", message }

import readXlsxFile from "read-excel-file/web-worker";

const URL_KEYWORDS = ["url","link","uri","href","כתובת","קישור","לינק","כתובת url","כתובת אתר"];
const DATE_KEYWORDS = ["date","time","visited","visit","timestamp","last visit","first visit","תאריך","זמן","ביקור","כניסה","מועד"];

function parseCsvText(text) {
  const s = text.replace(/^\uFEFF/, "");
  const rows = [];
  let i = 0;
  const len = s.length;
  while (i < len) {
    const row = [];
    while (i < len && s[i] !== "\n" && s[i] !== "\r") {
      if (s[i] === '"') {
        i++;
        let cell = "";
        while (i < len) {
          if (s[i] === '"' && s[i + 1] === '"') { cell += '"'; i += 2; }
          else if (s[i] === '"') { i++; break; }
          else cell += s[i++];
        }
        row.push(cell);
        if (i < len && s[i] === ",") i++;
      } else {
        let j = i;
        while (j < len && s[j] !== "," && s[j] !== "\n" && s[j] !== "\r") j++;
        row.push(s.slice(i, j));
        i = j;
        if (i < len && s[i] === ",") i++;
      }
    }
    if (i < len && s[i] === "\r") i++;
    if (i < len && s[i] === "\n") i++;
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

function normalizeHeader(s) {
  return String(s ?? "").trim().toLowerCase()
    .replace(/[\u200f\u200e]/g, "")
    .replace(/[\s\-_.:;|/\\]+/g, " ")
    .trim();
}

function scoreHeader(header, keywords) {
  const h = normalizeHeader(header);
  if (!h) return 0;
  let score = 0;
  for (const kw of keywords) {
    const k = normalizeHeader(kw);
    if (!k) continue;
    if (h === k) score += 6;
    else if (h.includes(k)) score += 3;
  }
  return score;
}

function isLikelyUrl(str) {
  if (!str) return false;
  const s = String(str).trim();
  return /^(https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,})(\/|\?|#|$)/i.test(s);
}

function canonicalizeUrl(input) {
  const raw = String(input ?? "").trim().replace(/^"+|"+$/g, "");
  if (!raw) return null;
  const withProto = raw.match(/^https?:\/\//i) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    u.hostname = u.hostname.toLowerCase();
    u.hash = "";
    if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/g, "");
    return u.toString();
  } catch {
    return isLikelyUrl(raw) ? raw : null;
  }
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./i, "").toLowerCase(); }
  catch { return ""; }
}

function excelSerialToDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const utc = new Date(Date.UTC(1899, 11, 30));
  utc.setUTCDate(utc.getUTCDate() + Math.floor(n));
  const frac = n - Math.floor(n);
  if (frac > 0) {
    utc.setUTCHours(0, 0, 0, 0);
    utc.setTime(utc.getTime() + Math.round(frac * 86400000));
  }
  return utc;
}

function toISODate(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number") {
    const d = excelSerialToDate(value);
    return d ? d.toISOString() : "";
  }
  const s = String(value).trim();
  if (!s) return "";
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    let dd = Number(m[1]), mm = Number(m[2]), yy = Number(m[3]);
    if (yy < 100) yy = 2000 + yy;
    const hh = Number(m[4] ?? 0), mi = Number(m[5] ?? 0), ss = Number(m[6] ?? 0);
    const d = new Date(Date.UTC(yy, mm - 1, dd, hh, mi, ss));
    return isNaN(d.getTime()) ? "" : d.toISOString();
  }
  return "";
}

self.onmessage = async (e) => {
  const { file } = e.data;
  try {
    const ext = (file.name.split(".").pop() || "").toLowerCase();

    let rows = [];
    if (ext === "csv") {
      const text = await file.text();
      rows = parseCsvText(text);
    } else if (ext === "xlsx") {
      rows = await readXlsxFile(file);
      rows = rows.map(r => r.map(v => (v === null || v === undefined) ? "" : v));
    } else {
      throw new Error("פורמט לא נתמך. העלה CSV או XLSX");
    }

    if (!rows.length) throw new Error("הקובץ ריק או לא ניתן לקריאה.");

    let headerRowIndex = 0;
    while (headerRowIndex < rows.length && rows[headerRowIndex].every(v => String(v ?? "").trim() === "")) headerRowIndex++;

    const headers = rows[headerRowIndex] || [];
    const dataRows = rows.slice(headerRowIndex + 1);

    let urlCol = -1, dateCol = -1;
    let bestUrlScore = 0, bestDateScore = 0;

    headers.forEach((h, idx) => {
      const us = scoreHeader(h, URL_KEYWORDS);
      const ds = scoreHeader(h, DATE_KEYWORDS);
      if (us > bestUrlScore) { bestUrlScore = us; urlCol = idx; }
      if (ds > bestDateScore) { bestDateScore = ds; dateCol = idx; }
    });

    const hasUrlCol = urlCol >= 0 && bestUrlScore > 0;
    const hasDateCol = dateCol >= 0 && bestDateScore > 0;

    let scannedUrls = 0;
    let invalidUrls = 0;
    const extracted = [];

    for (const r of dataRows) {
      let urlCandidate = hasUrlCol ? r[urlCol] : "";
      let url = canonicalizeUrl(urlCandidate);

      if (!url) {
        for (let i = 0; i < r.length; i++) {
          if (i === urlCol) continue;
          const v = r[i];
          if (!isLikelyUrl(v)) continue;
          const c = canonicalizeUrl(v);
          if (c) { url = c; break; }
        }
      }

      if (!url) { invalidUrls++; continue; }
      scannedUrls++;

      let iso = "";
      if (hasDateCol) iso = toISODate(r[dateCol]);
      if (!iso) {
        for (let i = 0; i < r.length; i++) {
          const candidate = toISODate(r[i]);
          if (candidate) { iso = candidate; break; }
        }
      }

      extracted.push({ url, domain: getDomain(url), iso });
    }

    self.postMessage({
      type: "done",
      records: extracted,
      meta: {
        headerRowIndex,
        headers,
        urlCol: hasUrlCol ? urlCol : null,
        dateCol: hasDateCol ? dateCol : null,
        scannedUrls,
        invalidUrls,
        records: extracted.length,
      },
    });
  } catch (err) {
    self.postMessage({ type: "error", message: err?.message || "שגיאה לא צפויה" });
  }
};
