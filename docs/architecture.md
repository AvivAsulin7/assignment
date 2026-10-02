# Architecture — Squanchy Bakery Fridge Temperature Monitor (MVP)

Companion to [`requirements.md`](./requirements.md). This document describes *how* the MVP is built; requirement and assumption IDs (A1…A24) refer to that file.

**Design goals:** simplicity, runs on a laptop with no accounts or paid services, clear separation of concerns, testability, deterministic and explainable business rules, and a clone-to-running setup of a few minutes.

---

## 1. High-level architecture

Three pieces, one laptop:

- **Web app** — React + TypeScript single-page app, built with Vite. Mobile-first.
- **API server** — Node.js + TypeScript, Express, REST/JSON. In production mode it also serves the built client app, so there is one process, one port and one URL (reachable from a phone on the same network).
- **Database** — a single SQLite file, accessed via better-sqlite3.

```
┌──────────────┐   JSON / REST   ┌─────────────────────────────────────────────────┐
│  React SPA   │ ──────────────▶ │  api/  (routes, Zod validation, response DTOs)  │
│  (Vite, TS)  │ ◀────────────── │        │                          │             │
└──────────────┘                 │   imports/ service          fridge queries      │
                                 │   │         │       │               │     │     │
                                 │ parsing/ → normalization/ → persistence/ → analysis/
                                 │                             │                   │
                                 │                     ┌───────▼────────┐          │
                                 │                     │ SQLite (1 file)│          │
                                 └─────────────────────┴────────────────┴──────────┘
```

Two core principles:

1. **Store source data, derive everything else.** Only readings (raw + normalised) and import metadata are persisted. Excursions, spikes, gaps, warming findings and status are computed on read by pure functions. There are no stale derived results, and every classification can be traced back to the readings it came from.
2. **Business rules live in pure functions.** Parsing, normalisation and analysis have no knowledge of HTTP, the database, React or Express.

---

## 2. Upload / import / data flow

### 2.1 Preview (nothing stored)

```
User picks a CSV
  → browser reads it as text (File.text())
  → POST /api/uploads/preview { filename, content, columns? }
       parsing:        CSV text → header + string rows
                       detect timestamp/temperature columns via case-insensitive aliases (A2)
                       or apply the user's column choice if provided
       normalization:  parse timestamps and temperature values, sort,
                       count invalid rows, rejected rows, in-file duplicates/conflicts,
                       compute suspicious-unit hints (A10)
  ← preview: column detection result (confident / candidates), counts,
             first/last timestamp, sample rows, unit hints
```

If columns cannot be identified confidently, the preview says so and the UI asks the user to pick them; the preview is re-requested with `columns` set.

### 2.2 Confirm and import

```
User confirms columns and enters Logger ID, Branch, Fridge, Unit (default °C)
  → POST /api/imports { filename, content, columns, loggerId, branch, fridge, unit }
       parsing + normalization  (same pure functions as preview; now with unit → °C)
       imports service, in ONE database transaction:
         1. find-or-create the fridge by normalised (branch, fridge) name keys (A8)
         2. insert the import row: logger → fridge assignment, unit, columns, raw CSV
         3. insert readings; skip duplicates; record conflicts (see §5.3)
  ← import summary: inserted / invalid / rejected / duplicate / conflict counts,
                    conflict details, fridge id
```

The client re-sends the file content on import. The server keeps no preview state between the two calls; because parsing and normalisation are deterministic, the import sees exactly what the preview showed.

### 2.3 Viewing

```
GET /api/fridges       → load each fridge's readings → analysis → status + summary
GET /api/fridges/:id   → load the fridge's readings  → analysis → readings + findings
```

Analysis always runs over the fridge's **full stored history**, across all imports and loggers that were assigned to it, so an excursion that spans two weekly files is seen as one event.

---

## 3. Backend module responsibilities

| Module | Owns | Does NOT own |
|---|---|---|
| **`domain/`** | Shared domain types (`ParsedRow`, `NormalizedReading`, `Excursion`, `Gap`, `Spike`, …) and the name-key helper (trim, collapse whitespace, lower-case). | Any I/O or rules beyond name keys. |
| **`parsing/`** | CSV text → header + string cells (via PapaParse). Column detection by alias. Applying a user-selected column mapping. Reporting "not confident". | Interpreting values (dates, numbers, units). Database. HTTP. Outputs strings only. |
| **`normalization/`** | Timestamp parsing for the supported formats (A3) into canonical local time. Temperature parsing (`ERR`/empty/non-numeric → invalid with reason, A12). °F → °C conversion (A9). Chronological sort (A13). In-file duplicate/conflict detection. Suspicious-unit hints (A10). Keeps raw text alongside every normalised value (A11). | Database. Fridges/loggers. Analysis rules. HTTP. Pure functions only. |
| **`imports/`** | Orchestrates preview and import: parse → normalise → persist. Find-or-create fridge. Duplicate/conflict detection against stored readings. Transaction boundary. Import summary. | CSV details, temperature rules, SQL text (uses repositories), HTTP. |
| **`analysis/`** | Pure functions from one fridge's chronologically sorted readings to gaps, above-threshold runs, isolated spikes, excursions, warming findings and status. All thresholds/parameters are named constants in one place. No clock: any "now" or time window is an explicit argument. | Database, parsing, units (only ever sees °C), HTTP, React, Express. |
| **`persistence/`** | Schema (`schema.sql`, applied at startup with `CREATE TABLE IF NOT EXISTS`), database connection, repositories with plain SQL, transactions. Enforces the unique key. | Business rules. |
| **`api/`** | Express app factory, routes, Zod request validation, mapping domain errors to HTTP status codes, response shaping, serving the built client app. | Business logic — handlers are thin and delegate to services. |

The Express app is created by a factory (`createApp(db)`) so integration tests can run it against an in-memory database.

---

## 4. Frontend

Three pages, mobile-first, plain CSS, no state-management library (each page fetches its own data through a small `api.ts` wrapper).

1. **Overview — `/`**
   Fridges grouped by branch, problems surfaced first. Each fridge card: name, status badge, latest reading and its time, counts of findings. Tap → detail.

2. **Upload — `/upload`**, a single page with three steps:
   1. *Choose file* — one CSV at a time.
   2. *Preview & confirm* — detected columns (or two dropdowns when not confident), counts, date range, sample rows, unit hints. Form for Logger ID, Branch, Fridge (with suggestions from existing fridges) and a °C/°F toggle defaulting to °C. Import button.
   3. *Result* — import summary (including duplicates and conflicts) and a link to the fridge.

3. **Fridge detail — `/fridges/:id`**
   Status header; temperature chart with the 5 °C reference line, excursions shaded, spikes marked and gaps shown as breaks in the line; the **"Above 5 °C" list** (start, end, duration, peak, flags such as *ongoing* and *contains missing data*) that answers the inspector's question; gaps and spikes lists; a collapsible readings table showing raw text, °C value, logger and import for traceability.

Shared components: `StatusBadge`, `TemperatureChart`, `EventList`.

The client app keeps its own `types.ts` for API responses rather than a shared package; API response shapes are pinned by the backend integration tests.

---

## 5. Data model

Three tables. No separate branches, loggers, assignments or analysis-results tables.

```sql
fridges
  id              INTEGER PRIMARY KEY
  branch_name     TEXT NOT NULL      -- display spelling (first seen)
  name            TEXT NOT NULL      -- display spelling (first seen)
  branch_key      TEXT NOT NULL      -- normalised: trimmed, collapsed whitespace, lower-case
  name_key        TEXT NOT NULL
  created_at      TEXT NOT NULL
  UNIQUE (branch_key, name_key)

imports                               -- one row per confirmed upload
  id                  INTEGER PRIMARY KEY
  fridge_id           INTEGER NOT NULL REFERENCES fridges(id)  -- assignment at import time
  logger_id           TEXT NOT NULL
  unit                TEXT NOT NULL CHECK (unit IN ('C','F'))
  filename            TEXT NOT NULL
  timestamp_column    TEXT NOT NULL
  temperature_column  TEXT NOT NULL
  raw_content         TEXT NOT NULL     -- original CSV, verbatim
  row_count           INTEGER NOT NULL
  inserted_count      INTEGER NOT NULL
  invalid_count       INTEGER NOT NULL
  rejected_count      INTEGER NOT NULL
  duplicate_count     INTEGER NOT NULL
  conflict_count      INTEGER NOT NULL
  imported_at         TEXT NOT NULL

readings                              -- one row per stored data row
  id                INTEGER PRIMARY KEY
  import_id         INTEGER NOT NULL REFERENCES imports(id)
  fridge_id         INTEGER NOT NULL REFERENCES fridges(id)   -- copied from import, immutable
  logger_id         TEXT NOT NULL                             -- copied from import, immutable
  source_line       INTEGER NOT NULL  -- line number in raw_content
  recorded_at       TEXT NOT NULL     -- canonical local time 'YYYY-MM-DD HH:MM:SS'
  raw_timestamp     TEXT NOT NULL
  raw_temperature   TEXT NOT NULL
  temperature_c     REAL              -- NULL when invalid
  is_valid          INTEGER NOT NULL  -- 0 / 1
  invalid_reason    TEXT              -- e.g. 'non-numeric value: ERR'
  UNIQUE (logger_id, recorded_at)
```

### 5.1 Fridge vs logger, and preserving history when a logger moves

- The **fridge** is the entity that matters: it is what the overview shows and what the inspector asks about.
- A **logger** is only an identifier recorded on an import. We do not manage logger assignments.
- Each **import** records the logger → fridge assignment given at upload time (A7). Every reading from that import carries that `fridge_id` permanently.
- When TL-0417 is later uploaded as Tel Aviv / Display 2, that creates a new import pointing to a different fridge. Readings from the earlier Walk-in import are untouched and remain Walk-in history.
- `fridge_id` and `logger_id` are copied onto each reading. This is intentional denormalisation: both values are immutable once imported, and it keeps per-fridge queries and the unique key simple.

### 5.2 Raw vs normalised data, invalid and rejected rows

- Each reading stores both its raw text (`raw_timestamp`, `raw_temperature`) and its normalised values (`recorded_at`, `temperature_c`).
- The full original file is kept in `imports.raw_content`, so nothing from the upload is ever lost.
- **Invalid readings** (valid timestamp, unusable temperature such as `ERR`) are stored with `is_valid = 0`, `temperature_c = NULL` and a reason. Analysis treats them as missing data.
- **Rejected rows** (timestamp cannot be parsed) cannot be placed in time or deduplicated, so they are not inserted as readings. They are counted (`rejected_count`), shown in the preview and summary, and preserved in `raw_content`.

### 5.3 Duplicate identity and re-uploads

**MVP assumption:** *We assume one physical logger produces at most one reading for a given timestamp.* Therefore a reading is identified by `UNIQUE (logger_id, recorded_at)`.

| Incoming row vs stored / earlier row with same logger + timestamp | Outcome |
|---|---|
| Same value (same raw temperature after normalisation, including both invalid) | **Duplicate** — skipped, counted. |
| Different value (including valid vs invalid) | **Conflict** — the stored reading is left unchanged, the incoming row is not inserted; it is counted on the import and listed in the import summary. |

Consequences:
- Re-uploading the same file is safe: zero new readings, all rows counted as duplicates.
- Logger moves do not affect this: a logger's readings before and after a move have different timestamps.
- If a file is re-uploaded under the *wrong* fridge, it is detected as already imported instead of silently duplicating history into a second fridge.

This assumption must be confirmed with Summer / against real logger files before production.

---

## 6. API

Four endpoints. No others unless implementation proves one is necessary.

| Method & path | Purpose | Request | Response (outline) |
|---|---|---|---|
| `POST /api/uploads/preview` | Parse and validate a file without storing anything | `{ filename, content, columns? }` | `{ columns: { timestamp, temperature, confident, candidates }, counts, firstAt, lastAt, sampleRows, unitHints }` |
| `POST /api/imports` | Confirm and import | `{ filename, content, columns, loggerId, branch, fridge, unit }` | `{ importId, fridgeId, counts, conflicts }` |
| `GET /api/fridges` | Overview | — | `[{ id, branch, name, status, latestReading, counts }]` (also used for name suggestions) |
| `GET /api/fridges/:id` | Fridge detail with analysis | — | `{ fridge, status, readings, excursions, spikes, gaps, warming }` |

- Uploads are sent as JSON with the CSV content as a string (the browser reads the file). This avoids multipart middleware and lets preview and import share one Zod schema. A JSON body-size limit (a few MB) is configured; logger files are small.
- Validation errors return `400` with Zod's messages; unknown fridge returns `404`.

---

## 7. Analysis architecture

- **Input:** one fridge's readings (valid and invalid), sorted by `recorded_at`, temperatures in °C, each carrying its `import_id` and `logger_id`.
- **Output:** plain data structures — gaps, isolated spikes, excursions, warming findings, status — each referencing the readings (by id / timestamp) it was derived from.
- **Pure and deterministic:** no database, HTTP, React, Express or clock access. Anything time-relative is passed in as an argument.
- **Rules as named constants** in a single `rules.ts` (e.g. the 5.0 °C threshold, the gap multiplier), so each rule is easy to find, test and explain.
- **Computed on read, never persisted.** At this data volume (thousands to tens of thousands of readings) recomputation is negligible, and it guarantees results always reflect current data and current rules.

Components, each a separate pure function:

| Function | Rule source |
|---|---|
| Expected interval per import | A16 |
| Gap detection | A17 |
| Above-threshold runs | A15, A18 |
| Isolated spike classification | A19 |
| Excursions (start, end, duration, peak, *ongoing*, *contains missing data*) | A20 |
| Gradual warming | A21 — **rule unresolved**, see §11 |
| Fridge status | A22 — **time window unresolved**, see §11 |

---

## 8. Testing strategy

Priority: parsing, normalisation and analysis rules — this is where correctness matters most.

### Unit tests (Vitest, pure functions, bulk of the effort)
- **Parsing:** alias detection in any column order and case; extra columns; not-confident result; applying a user column mapping; BOM, CRLF, empty file, header-only file.
- **Normalisation:** both timestamp formats; invalid dates rejected (e.g. `31/02/2026`); slash dates always DD/MM; °F → °C (38.3 °F → 3.5 °C); `ERR`/empty → invalid; sorting; in-file duplicates vs conflicts; unit hints.
- **Analysis**, table-driven from the assignment's scenarios:
  - Tel Aviv 4.1 / **9.4** / 4.3 → one isolated spike, no excursion.
  - Rishon 4.6 / 5.4 / 6.3 / 7.1 → excursion starting 06:15, ongoing.
  - Jerusalem 06:15 → 08:30 → gap.
  - Exactly 5.0 °C → in range.
  - Single high reading at the edge of data, or next to a gap / invalid reading → excursion, not spike.
  - Gap inside an excursion → flagged as containing missing data.
  - Excursion end = first valid reading ≤ 5.0 °C.
  - Warming and status tests once those rules are decided.

### Integration tests (Vitest + Supertest, in-memory SQLite)
- Preview stores nothing.
- Import stores readings and correct counts.
- Re-uploading the same file → 0 inserted, all duplicates.
- Conflicting value → reported; stored value unchanged.
- TL-0417 moved: earlier readings remain with Walk-in, later ones with Display 2.
- Haifa-style °F file with `DD/MM/YYYY` and `ERR` → stored correctly in °C with one invalid reading.
- `GET /api/fridges` and `GET /api/fridges/:id` return the expected analysis for seeded data.
- Validation errors → 400; unknown fridge → 404.

### End-to-end (optional)
At most one or two browser tests (upload → import → fridge shown as flagged). Lowest priority; skipped if time is short and noted in `NOTES.md`.

---

## 9. Project structure

npm workspaces with two packages.

```
/
├─ README.md
├─ NOTES.md
├─ package.json                 workspaces + root scripts (dev, build, start, test, seed)
├─ docs/
│  ├─ requirements.md
│  └─ architecture.md
├─ sample-data/                 raw logger CSVs covering the assignment scenarios
├─ server/
│  ├─ package.json  tsconfig.json
│  ├─ src/
│  │  ├─ domain/                types, name-key helper
│  │  ├─ parsing/
│  │  ├─ normalization/
│  │  ├─ analysis/              rules.ts + one file per rule
│  │  ├─ imports/               import/preview service
│  │  ├─ persistence/           schema.sql, db.ts, repositories
│  │  ├─ api/                   createApp(), routes, Zod schemas
│  │  └─ index.ts               starts the server
│  ├─ scripts/
│  │  └─ seed.ts                imports sample-data through the import service
│  └─ test/
│     ├─ unit/
│     ├─ integration/
│     └─ fixtures/
└─ client/
   ├─ package.json  tsconfig.json  vite.config.ts  index.html
   └─ src/
      ├─ main.tsx
      ├─ api.ts  types.ts
      ├─ pages/                 Overview, Upload, FridgeDetail
      └─ components/            StatusBadge, TemperatureChart, EventList
```

Reviewer workflow (to be detailed in `README.md`): `npm install` → optionally `npm run seed` → `npm run build && npm start` → open `http://localhost:3000`. `npm run dev` runs server and client with hot reload for development.

---

## 10. Technology choices

### Approved
| Technology | Why |
|---|---|
| **React + TypeScript + Vite** | Standard, typed, fast dev server and build with near-zero configuration. |
| **Node.js + TypeScript + Express** | Minimal, well-known HTTP layer; enough for four routes plus static files. |
| **SQLite via better-sqlite3** | Single file, no server, no account. Mature driver; synchronous API makes transactions simple; prebuilt binaries for Windows/macOS/Linux. |
| **PapaParse** | Correct CSV handling (quoting, BOM, CRLF, delimiter detection). Hand-rolled splitting would put bugs in the most important part of the system. |
| **Zod** | Validates untrusted request bodies at the API boundary with readable errors. |
| **Recharts** | Provides exactly what the detail chart needs: a threshold reference line, shaded ranges for excursions, and line breaks at gaps. |
| **Vitest + Supertest** | TypeScript-native test runner; HTTP-level integration tests against the real Express app. |

### Supporting (proposed, small)
| Technology | Why |
|---|---|
| **react-router** | Deep links to `/fridges/:id` and working back navigation on a phone. |
| **tsx** (dev) | Run TypeScript server code and scripts without a separate build step during development. |
| **concurrently** (dev) | Start server and client together with a single cross-platform `npm run dev`. |

### Deliberately not used
- No ORM or migration tool — three tables, schema applied at startup.
- No date library — two strict formats parsed explicitly; timestamps treated as local time, which avoids time-zone surprises.
- No CSS framework — plain CSS is enough for three pages.
- No client state library (Redux, React Query) — pages fetch their own data.
- No Docker, no external services.

---

## 11. Deliberate trade-offs

### Intentionally simple for the take-home
- Analysis recomputed on every read; no caching or stored results.
- Single user, no authentication, one local SQLite file.
- JSON upload of one file at a time; the raw file is stored in the database.
- Naive local timestamps; DST transitions not handled.
- Fridges created implicitly on first upload; no rename/merge/delete UI.
- Schema created at startup; no migrations.
- Duplicate identity based on an unconfirmed assumption about logger behaviour (§5.3).

### What would change for production
- Authentication and per-branch roles.
- Postgres with versioned migrations; raw files in object storage.
- Persisted or incremental analysis results with an audit trail of which rule version produced each finding shown to an inspector.
- Time-zone-aware timestamps and DST handling.
- Real logger-to-fridge assignment management.
- Alerts, and more frequent uploads than weekly.
- Bulk multi-file upload.
- Upload limits, rate limiting, structured logging.

---

## 12. Unresolved decisions

These are intentionally left open. The architecture accommodates them without committing to an answer.

1. **Exact gradual-warming rule** (A21). Will live in its own pure function in `analysis/`, with parameters as named constants, under the constraints stated in `requirements.md`.
2. **Exact time window used to determine overview status** (A22). The status function will receive the window and reference time as explicit arguments.
3. **Gap behaviour between separate weekly imports** — e.g. how the period between the last reading of one import and the first reading of the next import for the same fridge is treated, and which expected interval applies.
