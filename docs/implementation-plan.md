# Implementation Plan — MVP

Follows [`requirements.md`](./requirements.md), [`architecture.md`](./architecture.md) and [`../CLAUDE.md`](../CLAUDE.md). Nothing here changes a documented decision; unresolved decisions appear as explicit **decision checkpoints** (🛑) that must be settled and documented before the dependent work starts.

## Planning principles

- Small phases, each reviewed before the next one starts; one or a few commits per phase.
- Business logic (parsing, normalisation, analysis) is written test-first or alongside its tests, as pure functions that are testable in isolation.
- Vertical progress where practical: the upload path is taken end-to-end (file → preview → import → stored readings) before the analysis-heavy views are built.
- No functionality beyond the documented MVP. No answers invented for unresolved decisions.
- `NOTES.md` is kept as a running draft from Phase 1 (decisions, AI mistakes caught, time spent), so Phase 11 is an edit, not a reconstruction.

## Decision checkpoints

| ID | Decision | Needed before | Blocks |
|---|---|---|---|
| ✅ **D1** | Gap behaviour between separate imports — **decided:** gaps are detected within a single import only (requirements A17) | Phase 5, step 5.2 | — |
| ✅ **D2** | Gradual-warming rule — **decided:** ≥ 3 consecutive increases (≥ 4 valid readings), ≥ 1.0 °C total rise, a gap ends the sequence (requirements A21) | Phase 5, step 5.4 | — |
| ✅ **D3** | Overview status window — **decided:** the fridge's latest import (requirements A22) | Phase 5, step 5.5 | — |
| ✅ **O1–O4** | **Decided** (requirements §2.7): recovered excursion still counts as *Excursion*; status import = the one whose readings end latest, imports without readings never change status; every import analysed independently; invalid readings break warming | Phase 5 | — |

At each checkpoint: Claude presents options with trade-offs → user decides → the decision is recorded in `requirements.md` / `architecture.md` / `NOTES.md` → implementation proceeds.

## Planned Claude Code Skills

| Skill | Created | Purpose |
|---|---|---|
| ~~**temperature-analysis**~~ | **Intentionally not created** | Was planned to encode the analysis rules for implementing and reviewing analysis code. Skipped: the rules are already captured in `requirements.md`, `architecture.md` and `NOTES.md`; the implementation is small and pure; and it is covered by focused tests. Adding a Skill after implementation would add process overhead without meaningful value in this time-boxed take-home. |
| **assignment-review** | Start of Phase 10 | Checks the repo against the assignment's deliverables and our docs: README clone-to-run, NOTES.md required topics, MVP scope coverage, out-of-scope creep, unresolved/TBD items, test status. |

---

## Phase 1 — Project foundation

- **Goal:** An empty but runnable, testable monorepo skeleton.
- **Implement:**
  - Root `package.json` with npm workspaces (`server`, `client`) and scripts: `dev`, `build`, `start`, `test`, `seed`.
  - `server/`: TypeScript config, Vitest config, Express `createApp(db)` factory and `index.ts` (no routes yet beyond serving the built client app in production mode), better-sqlite3 connection helper.
  - `client/`: Vite + React + TS scaffold, dev proxy `/api` → server, react-router with three empty routes.
  - `domain/` name-key helper (trim, collapse whitespace, lower-case) — first real code, used to prove the test setup.
  - `.gitignore` (node_modules, build output, SQLite file); `NOTES.md` draft.
- **Main files:** `package.json`, `server/{package.json,tsconfig.json,vitest.config.ts}`, `server/src/{index.ts,api/app.ts,persistence/db.ts,domain/names.ts}`, `client/{package.json,vite.config.ts,index.html,src/main.tsx}`, `NOTES.md`.
- **Tests:** Unit tests for the name-key helper (`"tel aviv"` ≡ `" Tel  Aviv "`).
- **Done when:** `npm install`, `npm test`, `npm run dev` and `npm run build && npm start` all work on a clean clone; the empty app opens in the browser.
- **Depends on:** —
- **Blocking decisions:** none.

## Phase 2 — CSV parsing

- **Goal:** Turn raw CSV text into a header + string rows and identify the timestamp/temperature columns (A1, A2).
- **Implement:** `parsing/` module using PapaParse: header/rows extraction, case-insensitive alias detection for timestamp and temperature columns, a "not confident" result with candidate columns, applying a user-selected column mapping. Outputs strings only.
- **Main files:** `server/src/parsing/*`, `server/test/unit/parsing.test.ts`, `server/test/fixtures/*.csv`.
- **Tests:** Columns in either order; alias and case variants; extra columns ignored; no recognisable header → not confident; user mapping applied; BOM; CRLF; quoted values; empty file; header-only file.
- **Done when:** All parsing tests pass; module has no imports from normalisation, persistence or API.
- **Depends on:** Phase 1.
- **Blocking decisions:** none.

## Phase 3 — Normalisation

- **Goal:** Turn parsed rows into normalised readings while preserving raw values (A3, A9–A14).
- **Implement:** `normalization/` module: timestamp parsing (`YYYY-MM-DD[ T]HH:MM[:SS]`, `DD/MM/YYYY HH:MM[:SS]`, slash always DD/MM, invalid calendar dates rejected); temperature parsing (`ERR`/empty/non-numeric → invalid with reason); °F → °C by the user-selected unit; chronological sort; in-file duplicate vs conflict detection; raw text kept alongside every normalised value; counts for preview/summary.
- **Main files:** `server/src/normalization/*`, `server/src/domain/types.ts`, `server/test/unit/normalization.test.ts`.
- **Tests:** Both formats; `31/02/2026` rejected; `05/09/2026` read as 5 September; 38.3 °F → 3.5 °C and 39.0 °F → 3.9 °C; `ERR` → invalid, not 0; out-of-order rows sorted (TL-0417 05:45); exact duplicate (Jerusalem 06:15 3.9) vs same timestamp with different value.
- **Done when:** All tests pass; parsing → normalisation pipeline works on the assignment scenarios as pure functions.
- **Depends on:** Phases 1–2.
- **Blocking decisions:** none.

## Phase 4 — Persistence and import flow

- **Goal:** Store imports and readings with preserved fridge assignment and safe re-uploads (A5, A7, A8, A11, A12, A14; architecture §5).
- **Implement:** `schema.sql` (fridges, imports, readings, `UNIQUE(logger_id, recorded_at)`) applied at startup; repositories; `imports/` service with `preview(input)` (no writes) and `import(input)` (one transaction: find-or-create fridge by name keys → insert import with raw content → insert readings, skipping duplicates and recording conflicts against stored data); import summary. Sample raw logger CSVs in `sample-data/` covering the assignment scenarios, and `scripts/seed.ts` that imports them through the service.
- **Main files:** `server/src/persistence/{schema.sql,db.ts,repositories/*}`, `server/src/imports/*`, `server/scripts/seed.ts`, `sample-data/*.csv`, `server/test/integration/imports.test.ts`.
- **Tests (service-level, in-memory SQLite):** preview writes nothing; import stores readings + correct counts; re-upload of the same file → 0 inserted, all duplicates; conflicting value → reported, stored value unchanged; TL-0417 Walk-in then Display 2 → earlier readings stay with Walk-in; `tel aviv` resolves to the existing Tel Aviv fridge; Haifa °F file with `ERR` → stored in °C with one invalid reading; rejected-timestamp rows counted and not inserted; failed import leaves nothing behind (transaction).
- **Done when:** Tests pass; `npm run seed` populates a database from `sample-data/`.
- **Depends on:** Phases 1–3.
- **Blocking decisions:** none.

## Phase 6a — REST API: upload endpoints *(done before Phase 5 for an early vertical slice)*

- **Goal:** Expose preview and import over HTTP.
- **Implement:** `POST /api/uploads/preview` and `POST /api/imports` with Zod schemas, thin handlers delegating to the import service, 400 on validation errors, JSON body-size limit.
- **Main files:** `server/src/api/{routes/uploads.ts,routes/imports.ts,schemas.ts,app.ts}`, `server/test/integration/api-uploads.test.ts`.
- **Tests (Supertest):** preview returns detection/counts/hints; preview with explicit `columns`; import returns summary; invalid body → 400; re-upload via API → duplicates.
- **Done when:** Tests pass; endpoints callable from the dev frontend.
- **Depends on:** Phase 4.
- **Blocking decisions:** none.

## Phase 7 — Frontend upload flow

- **Goal:** Summer can upload a raw CSV from her phone, preview it, enter metadata and import it.
- **Implement:** `/upload` page with three steps: choose file → preview (detected columns or two column dropdowns, counts, date range, sample rows) + form (Logger ID, Branch, Fridge, °C/°F defaulting to °C) → result summary (inserted/invalid/rejected/duplicates/conflicts). `api.ts` fetch wrapper and `types.ts`. Mobile-first CSS. Branch/fridge suggestions are added in Phase 8 once `GET /api/fridges` exists.
- **Main files:** `client/src/pages/Upload.tsx`, `client/src/{api.ts,types.ts}`, `client/src/styles.css`.
- **Tests:** Manual verification at phone width (≈375 px) with the sample files, including the not-confident column path and the Haifa °F file. Automated UI tests not planned (architecture §8).
- **Done when:** Every file in `sample-data/` can be previewed and imported through the UI; the summary matches the service tests.
- **Depends on:** Phase 6a.
- **Blocking decisions:** none.

## Phase 5 — Temperature analysis

- **Goal:** Pure, deterministic analysis of one fridge's readings (A15–A22; architecture §7).
- **5.0 — ~~Create the `temperature-analysis` Skill~~ — intentionally skipped** (see *Planned Claude Code Skills*).
- **5.1 — Rules file and core functions:** `analysis/rules.ts` (threshold 5.0 °C strict, gap multiplier 2×); expected interval per import (median spacing, A16); above-threshold runs (A18).
- **5.2 — Gaps:** gap detection within a single import only (A17, D1, O3).
- **5.3 — Spikes and excursions:** isolated spike classification (A19); excursions with start / end (first valid reading ≤ 5.0 °C) / duration / peak / *ongoing* / *contains missing data* (A20). Excursions never span imports (O3).
- **5.4 — Warming:** implement the D2 rule test-first (A21); gaps and invalid readings break a sequence (O4), sequences never cross imports (O3).
- **5.5 — Status:** status from the fridge's latest import (A22, D3), priority Excursion > Warming > Data gaps > OK; a recovered excursion still counts (O1); the status import is the one whose readings end latest (O2).
- **Main files:** `server/src/analysis/{rules.ts,interval.ts,gaps.ts,runs.ts,spikes.ts,excursions.ts,warming.ts,status.ts,index.ts}`, `server/test/unit/analysis/*.test.ts`.
- **Tests (table-driven):** Tel Aviv 4.1 / 9.4 / 4.3 → one spike, no excursion; Rishon 4.6 / 5.4 / 6.3 / 7.1 → excursion from 06:15, ongoing; Jerusalem 06:15 → 08:30 → gap; exactly 5.0 → in range; single high reading at start/end of data or next to a gap/invalid reading → excursion; gap inside excursion → flagged; `ERR` inside a run treated as missing; no gap inferred between imports (D1); no sequence crosses an import boundary (O3); warming cases (D2, O4); status cases (D3, O1, O2).
- **Done when:** All analysis tests pass; `analysis/` imports nothing from persistence, API, Express or React and reads no clock; every finding references the readings it came from; D1–D3 and O1–O4 recorded in the docs.
- **Depends on:** Phases 1, 3 (types and normalised readings). Independent of persistence.
- **Blocking decisions:** none (D1–D3 and O1–O4 decided).

## Phase 6b — REST API: fridge endpoints

- **Goal:** Expose overview and fridge detail with computed analysis.
- **Implement:** `GET /api/fridges` (fridge list with status, latest reading, finding counts) and `GET /api/fridges/:id` (fridge, status, readings with raw values/logger/import, excursions, spikes, gaps, warming). Handlers load readings via repositories and call `analysis/`; 404 for unknown fridge.
- **Main files:** `server/src/api/routes/fridges.ts`, a small fridge query service, `server/test/integration/api-fridges.test.ts`.
- **Tests (Supertest, seeded in-memory DB):** overview lists all sample fridges with expected statuses; detail for Rishon shows the excursion; detail for Tel Aviv Walk-in shows the spike and no Display 2 readings; unknown id → 404.
- **Done when:** Tests pass.
- **Depends on:** Phases 4, 5.
- **Blocking decisions:** none.

## Phase 8 — Fridge overview

- **Goal:** "See, in one place, how every fridge is doing and where something is wrong" on a phone.
- **Implement:** `/` page: fridges grouped by branch, problems first; fridge cards with `StatusBadge`, latest reading and time, finding counts; link to detail. Add branch/fridge suggestions to the upload form from `GET /api/fridges`.
- **Main files:** `client/src/pages/Overview.tsx`, `client/src/components/StatusBadge.tsx`, `client/src/pages/Upload.tsx`.
- **Tests:** Manual verification at phone and desktop widths with seeded data.
- **Done when:** Seeded data shows the expected statuses (Rishon excursion, Tel Aviv spike not alarmed, Jerusalem gap, Haifa correct in °C).
- **Depends on:** Phase 6b.
- **Blocking decisions:** none.

## Phase 9 — Fridge detail / history

- **Goal:** Answer "when did this fridge go above 5 °C, and for how long?" with traceable evidence.
- **Implement:** `/fridges/:id` page: status header; `TemperatureChart` (Recharts) with 5 °C reference line, shaded excursions, spike markers, gaps as line breaks; "Above 5 °C" list (start, end, duration, peak, *ongoing* / *contains missing data*); gaps and spikes lists (`EventList`); collapsible readings table with raw text, °C, logger and import.
- **Main files:** `client/src/pages/FridgeDetail.tsx`, `client/src/components/{TemperatureChart.tsx,EventList.tsx}`.
- **Tests:** Manual verification at phone width with seeded data, including Tel Aviv Walk-in vs Display 2 history and the Haifa `ERR` row visible in the readings table.
- **Done when:** For every sample scenario, the page shows the finding and the raw readings behind it.
- **Depends on:** Phases 6b, 8.
- **Blocking decisions:** none beyond those already resolved in Phase 5.

## Phase 10 — Integration and final testing

- **Goal:** Confidence that the whole system works from a clean clone.
- **Implement:** Create the **`assignment-review` Skill** (step 10.0). Fill test gaps found during Phases 7–9; end-to-end check of the full flow (upload → import → overview → detail) with every sample file, on a clean database; verify `npm install` → `npm run build && npm start` from a fresh clone; check phone access over the local network. Optional: one Playwright end-to-end test if time allows.
- **Main files:** `server/test/**`, `sample-data/*`, `.claude/skills/assignment-review/`.
- **Tests:** Full suite green; any skipped/failing tests reported, not hidden.
- **Done when:** Full suite passes; clean-clone run verified; `assignment-review` Skill run and its findings addressed or recorded.
- **Depends on:** Phases 1–9.
- **Blocking decisions:** none.

## Phase 11 — README, NOTES and final assignment review

- **Goal:** Deliverables required by the assignment.
- **Implement:**
  - `README.md`: prerequisites (Node version), clone → install → seed → run in a few minutes, dev mode, running tests, opening on a phone, where the docs are.
  - `NOTES.md` (finalised from the running draft): time spent; decisions Summer didn't ask for and why; questions for Summer (from `requirements.md` §5); what's not done and what we'd do with one more hour; how AI tools were used, including one thing they got wrong or we rejected, how it was caught, and where it's visible in the repo; anything else about the approach.
  - Final run of the `assignment-review` Skill; confirm the repository is public before submitting.
- **Main files:** `README.md`, `NOTES.md`, docs touch-ups.
- **Tests:** Follow the README literally on a clean clone.
- **Done when:** Assignment review passes; README verified from scratch; all NOTES topics covered.
- **Depends on:** Phase 10.
- **Blocking decisions:** none.

---

## Recommended implementation order

- [ ] **Phase 1** — Project foundation
- [ ] **Phase 2** — CSV parsing
- [ ] **Phase 3** — Normalisation
- [ ] **Phase 4** — Persistence and import flow (+ sample data, seed)
- [ ] **Phase 6a** — API: preview & import endpoints
- [ ] **Phase 7** — Frontend upload flow *(first end-to-end vertical slice)*
- [x] ~~**Phase 5.0** — Create `temperature-analysis` Skill~~ — intentionally skipped
- [ ] **Phase 5.1** — Rules, interval, above-threshold runs
- [x] ✅ **D1** — Gaps within one import only (decided)
- [x] ✅ **O3** — Every import analysed independently (decided)
- [x] ✅ **D2** — Warming rule (decided)
- [x] ✅ **O4** — Invalid readings break warming (decided)
- [x] ✅ **D3** — Status from latest import (decided)
- [x] ✅ **O1, O2** — Recovered excursion counts; latest import by reading time (decided)
- [ ] **Phase 6b** — API: fridge endpoints
- [ ] **Phase 8** — Fridge overview
- [ ] **Phase 9** — Fridge detail / history
- [ ] **Phase 10.0** — Create `assignment-review` Skill
- [ ] **Phase 10** — Integration and final testing
- [ ] **Phase 11** — README, NOTES, final assignment review
