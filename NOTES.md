# NOTES

## Time spent

- **7 hours** — not tracked with a timer; approximate, reconstructed from file and commit timestamps.
  - ~2 h reading the brief and writing requirements, architecture and the implementation plan.
  - ~3.5 h implementation (upload → import → analysis → API → overview → detail).
  - ~1.5 h final review, review fixes, README and these notes.

## Decisions Summer didn't ask for

- **One file = one logger; logger, branch and fridge are typed in at upload.** The brief says raw logger files contain only time + temperature, while Summer adds the remaining metadata when combining them.
- **°C / °F is chosen at upload, never guessed.** Compliance data shouldn't depend on a heuristic; °F is converted to °C and the raw value is kept.
- **The logger → fridge assignment is stored per import.** When a logger moves (TL-0417, Walk-in → Display 2), its earlier readings stay with the old fridge — history is never rewritten.
- **Each uploaded file is analysed on its own** — gaps, spikes, excursions and warming never join across files, because nothing in the brief says separate weekly files form one continuous recording. The overview status comes from the file with the most recent readings.
- **"Warming" = at least 3 consecutive rises (4 valid readings) totalling ≥ 1.0 °C.** The brief only says a one-reading jump is fine and slow warming isn't, so the numbers are an explicit MVP assumption to validate with Summer.

More detail: [`docs/requirements.md`](docs/requirements.md) §2 and [`docs/architecture.md`](docs/architecture.md).

## Questions for Summer before going live

- Is each raw file always from **one physical logger**? How do you know today **which fridge a file belongs to** (filename, sender, …)?
- Do the logger files **always have a header row**? Header-less files aren't supported yet (the preview warns about it).
- What are the loggers' **real sampling intervals**, and how long without data counts as a **meaningful gap**? (We flag > 2 × the file's interval.)
- What **warming pattern** should actually worry you — does "3 rises in a row, ≥ 1 °C in total" match "slowly warming up"?
- When uploads **overlap or conflict**, which value should win? (Today the first stored value is kept and the conflict is reported.)

## Not done / one more hour

- **Batch upload** with faster metadata entry — today it's one file at a time.
- **Frontend automated tests** — all automated tests are server-side; the client is checked manually.
- **Header-less CSV support**, if Summer confirms such files exist (today only a preview warning).

Beyond the take-home, production would also need authentication, a production database with migrations, observability and notifications.

## AI usage

Claude Code was used for the assignment analysis, drafting the requirements and architecture, phase-by-phase implementation, tests, and the final code/assignment review. Each phase ended with tests, a build and a written report that I reviewed before moving on; open business rules were raised as decisions for me rather than decided by the AI. Three examples:

- **Spike counted as warming (found by the AI, decided by me).** When the sample data was made more realistic in the final review, the door-opening reading in Tel Aviv / Walk-in (3.9 → 4.0 → 4.1 → **9.4** → 4.3) was flagged as *warming*, even though 9.4 was already classified as an isolated spike. Claude stopped and asked instead of flattening the sample data to hide it; I chose to refine the rule so an isolated spike ends a warming sequence. See `spikeIds` in `server/src/analysis/analyze.ts` and the test *"does not count a door-opening spike after two small rises as warming"* in `server/test/unit/analysis.test.ts` (commit `cc1d4ea`).
- **Logger-ID casing caused duplicate readings.** The final review reproduced that re-uploading a file as `tl-0512` instead of `TL-0512` stored every reading twice. I decided a logger ID names a physical device and should be normalized with trim + upper-case before storage and duplicate checks. See `server/src/imports/service.ts` and the test *"treats logger IDs that differ only in case or spacing as the same logger"* in `server/test/integration/imports.test.ts` (commit `cc1d4ea`).
- **Rejected: a "last 7 days" status window.** The first requirements draft proposed computing fridge status over the last 7 days. The brief gives no basis for seven days, so I rejected it; status is instead based on the import containing the most recent readings, rather than an arbitrary time window. See `docs/requirements.md` A22 (decision D3).

## Approach

- Worked in deliberate steps: assignment → requirements → architecture → implementation plan → 11 small implementation phases → focused tests and the full suite after each phase → a final review against the brief.
- Underspecified business rules (gaps, warming, status) were written down as explicit decisions before coding; the process documents are in [`docs/`](docs/) and [`CLAUDE.md`](CLAUDE.md).
