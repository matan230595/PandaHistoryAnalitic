# CLAUDE.md — AI Assistant Guide for PandaHistoryAnalitic

## Project Overview

**PandaHistoryAnalitic Pro** is a client-side-only React PWA (Progressive Web App) that processes browser history files locally in the browser. Users upload CSV/XLSX/XLS files, the app extracts and deduplicates URLs, provides statistical visualizations, and allows export in multiple formats. No data ever leaves the user's browser.

The UI is fully Hebrew-localized (RTL layout).

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | React 18 |
| Build Tool | Vite 5 |
| Charts | Chart.js 4 |
| File Parsing | xlsx (SheetJS) |
| Icons | lucide-react |
| PWA | vite-plugin-pwa |
| Deployment | Vercel |

---

## Repository Structure

```
/
├── index.html          # HTML entry point (lang="he", dir="rtl")
├── vite.config.js      # Vite + PWA plugin configuration
├── vercel.json         # SPA rewrite rules for Vercel
├── .env.example        # Environment variable template
├── package.json        # Dependencies and npm scripts
├── public/             # Static assets (favicon, PWA icons)
└── src/
    ├── main.jsx        # React root mount (ReactDOM.createRoot)
    ├── App.jsx         # Entire application (~891 lines, single file)
    └── index.css       # Global styles and CSS custom properties (theming)
```

### Important: Single-File Architecture

The entire application lives in `src/App.jsx`. There are no sub-components in separate files. All logic, state management, utility functions, and UI rendering are co-located in this single file. Do not refactor this into separate files unless explicitly asked.

---

## Development Workflow

### Setup

```bash
npm install
npm run dev       # Start Vite dev server (hot reload)
```

### Build & Preview

```bash
npm run build     # Production build
npm run preview   # Serve production build locally
```

### No Tests

There is no test framework. Do not add or expect tests unless the user explicitly requests them.

---

## Environment Variables

Defined in `.env.example` and set via Vercel dashboard for production:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_APP_PASSWORD` | `panda` | Client-side password gate |
| `VITE_APP_TITLE` | `PandaHistoryAnalitic` | App title displayed in UI |

All environment variables must be prefixed with `VITE_` to be accessible in the browser (Vite requirement).

---

## Key Conventions & Patterns

### Utility Functions (top of App.jsx)

All data-processing helpers are plain functions defined before the React components:

- `normalizeHeader(str)` — lowercase + trim a header string
- `scoreHeader(str, keywords)` — score a header against keyword arrays; used for auto-detecting URL and date columns
- `isLikelyUrl(str)` — heuristic check for URL-like strings
- `canonicalizeUrl(str)` — normalize URLs: lowercase hostname, remove hash, strip trailing slash
- `getDomain(url)` — extract hostname from a canonicalized URL
- `excelSerialToDate(serial)` — convert Excel date serial number to JS Date
- `toISODate(val)` — parse multiple date formats to ISO string (ISO, dd/mm/yyyy, Excel serial, Unix timestamp)
- `formatDateForCsv(iso)` — format ISO date as dd/mm/yyyy for CSV output
- `downloadBlob(blob, filename)` — trigger browser file download
- `toCsvWithBom(rows)` — build CSV string with UTF-8 BOM (for Excel compatibility)
- `buildDomainStats(records)` — compute top-10 domain frequency counts
- `aggregate(records, mode)` — deduplicate by `url` or `domain`, track min/max date
- `isoToYearMonth(iso)` — extract `{ year, month }` from ISO date
- `computeTimeStats(records)` — build yearly and monthly breakdown objects
- `buildMonthsForYear(yearStats, year)` — generate 12-month array for chart data
- `safeBaseName(filename)` — strip file extension for use in export filenames

### State Variables (inside `App` component)

| State | Type | Purpose |
|---|---|---|
| `authed` | boolean | Password gate status (persisted in sessionStorage as `panda_auth_ok`) |
| `theme` | `'dark'`/`'light'` | UI theme (persisted in localStorage as `panda_theme`) |
| `deferredPrompt` | event/null | PWA install prompt event |
| `canInstall` | boolean | Whether PWA install button should show |
| `fileName` | string | Name of currently loaded file |
| `status` | `'idle'`/`'loading'`/`'ok'`/`'error'` | Processing state |
| `dedupeMode` | `'url'`/`'domain'` | Deduplication granularity |
| `dateMode` | `'first'`/`'last'` | Whether to show first or last visit date |
| `records` | array | Raw extracted records `[{ url, domain, iso }]` |
| `meta` | object | File metadata (row count, detected columns, etc.) |
| `searchText` | string | Table search filter |
| `yearFilter` | string | Year filter for table |
| `monthFilter` | string | Month filter for table |

### Chart Management

Charts are created using Chart.js with direct canvas refs. Pattern used throughout:

```jsx
const chartRef = useRef(null);
const chartInstance = useRef(null);

useEffect(() => {
  if (chartInstance.current) chartInstance.current.destroy();
  chartInstance.current = new Chart(chartRef.current, { ... });
  return () => chartInstance.current?.destroy();
}, [data]);
```

Always destroy existing chart instances before creating new ones to avoid canvas reuse errors.

### File Processing Pipeline

1. User uploads file (CSV/XLSX/XLS via `<input type="file">` or drag-and-drop)
2. `xlsx.read()` parses the file into a workbook
3. First sheet is extracted; first non-empty row becomes headers
4. `scoreHeader()` identifies the best URL column and optional date column
5. Each row's URL is validated with `isLikelyUrl()` and canonicalized with `canonicalizeUrl()`
6. Dates parsed with `toISODate()` supporting multiple formats
7. Records stored as `{ url, domain, iso }` objects in `records` state

### Export Functions

All exports use the currently filtered result set (not raw records):

- `exportCsv()` — CSV with UTF-8 BOM, formatted dates
- `exportXlsx()` — Excel with both ISO and formatted date columns
- `exportJson()` — JSON array of filtered records

### Theming

CSS custom properties in `index.css` drive the visual theme. Theme class (`dark`/`light`) is set on `document.documentElement`. The `panda_theme` localStorage key persists user preference. An initial theme-load script runs inline in `index.html` before React mounts to prevent flash of wrong theme.

---

## Deployment

### Vercel

The project is deployed to Vercel. Key configuration in `vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/" }] }
```

This enables SPA client-side routing. All routes are served from `index.html`.

### PWA

Configured via `vite-plugin-pwa` in `vite.config.js`:
- Auto-update strategy
- App icons: `pwa-192.png` and `pwa-512.png` in `public/`
- Theme color: `#0b1220`
- Display mode: `standalone`

---

## Security Considerations

- The password gate (`PasswordGate` component) is **client-side only** — it is not real authentication. Do not use it to protect sensitive data in production.
- All file processing happens in the browser; no data is sent to any server.
- When modifying file parsing logic, be careful to avoid path traversal or arbitrary code execution via malicious file content (the xlsx library parses in sandboxed JS, but formula injection in CSV is a risk for downstream Excel users — consider sanitizing cell values that start with `=`, `+`, `-`, `@`).

---

## Language & Localization

- All UI strings are in Hebrew.
- The HTML document has `lang="he"` and `dir="rtl"`.
- When adding new UI text, write it in Hebrew and ensure it respects RTL layout.
- Date formatting convention in the UI: `dd/mm/yyyy`.

---

## What NOT to Do

- Do not split `App.jsx` into multiple component files unless explicitly requested.
- Do not add a backend, API routes, or server-side logic — this is intentionally a local-only app.
- Do not add a test framework or test files unless requested.
- Do not add i18n libraries — the app is Hebrew-only by design.
- Do not add routing libraries (React Router, etc.) — this is a single-view app.
- Do not modify `vercel.json` SPA rewrites without understanding the deployment implications.
- Do not store user file data in localStorage (privacy constraint) — state is session-only.
