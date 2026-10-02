# Requirements — Squanchy Bakery Fridge Temperature Monitor

Source: `ASSIGNMENT.pdf` (Summer Smith's email + Triolla instructions).
Summer is unreachable for two weeks, so every gap in the email is resolved here as an explicit, documented decision.

**Guiding principle:** prefer deterministic, explainable business rules over clever heuristics. The app may be used to answer a Ministry of Health inspector, so every classification must be traceable back to the original readings. Original readings are never deleted, modified or hidden.

---

## 1. Client-stated requirements

What Summer actually said (paraphrased, with quotes where precise wording matters).

### The problem
- 12 branches, each with a few fridges; each fridge has a temperature logger clipped inside.
- Once a week each branch manager downloads the logger's file and emails it to Summer.
- She pastes everything into one Excel sheet (~3,000 rows/week) and looks for problems manually. It takes most of Sunday and she still misses things.
- A fridge of dairy in Rishon was thrown out because nobody noticed it "had been slowly dying for two days".

### What she wants
- **C1.** "Upload the files and see, in one place, how every fridge is doing and where something is wrong."
- **C2.** Be able to answer the inspector: *"When did this fridge go above five degrees, and for how long?"*
- **C3.** Use it mostly on her phone ("I'm between branches most of the day").

### Known messiness in the data
- **C4.** The old Haifa logger "shows the numbers differently" — sample values (38.3, 39.0) are consistent with Fahrenheit, and its dates use `DD/MM/YYYY` instead of `YYYY-MM-DD`.
- **C5.** "The files don't look quite the same from branch to branch, the columns move around."
- **C6.** A Tel Aviv logger (TL-0417) was moved from the Walk-in to the new display fridge (Display 2).
- **C7.** Files sometimes have a gap of a couple of hours; the cause (logger died / battery / didn't save) is unknown.
- **C8.** A single-reading jump (door opened for a delivery) "is fine". A fridge that is "slowly warming up is not fine".
- **C9.** The raw logger files contain **only time and temperature**. Logger number, branch and fridge are typed in by Summer when she pastes.

### Also visible in the sample rows (not stated, but present)
- An invalid reading: `ERR`.
- An exact duplicate row (TL-0512, 06:15, 3.9).
- Out-of-order rows (TL-0417 05:45 listed after 06:30).
- Inconsistent capitalisation of branch names (`Tel Aviv` vs `tel aviv`).
- Sample interval appears to be 15 minutes.

### Constraints from Triolla
- Must run on a laptop by following the README, with no accounts and no paid services. No deployment.
- Deliver `README.md` and `NOTES.md` (time spent, decisions, questions for Summer, what's not done, AI-tool usage).
- Few well-made, well-explained decisions are preferred over many half-finished features.

---

## 2. Assumptions and decisions

Each item is a call we made where the email is silent or ambiguous.

### 2.1 Input files
- **A1. Raw logger file format.** A raw logger file is a CSV with two meaningful columns: a timestamp and a temperature. It does **not** contain Logger ID, Branch or Fridge. The sample table in the assignment is Summer's *combined spreadsheet*, not a logger file. We generate our own sample raw files for development and demos.
- **A2. Column identification.** The system first tries known case-insensitive header aliases for the timestamp and temperature columns (e.g. `time`, `timestamp`, `date`, `datetime` / `temp`, `temperature`, optionally with a unit suffix). If the columns cannot be identified confidently, the user selects the timestamp and temperature columns in the upload preview. No content-based automatic column inference in the MVP. Extra columns are ignored.
  - The first non-blank row is always treated as the header row. **Header-less files are not supported in the MVP:** when the headers cannot be identified, the preview warns that the first row is being used as column names and that, if it is actually a reading, it will not be imported (Phase 10 decision; to confirm with Summer, §5).
- **A3. Timestamp formats.** Supported: `YYYY-MM-DD HH:MM[:SS]` (space or `T` separator) and `DD/MM/YYYY HH:MM[:SS]`. Slash dates are always interpreted as **day/month** (Israeli convention, consistent with Haifa's `14/09/2026`). Rows whose timestamp cannot be parsed are rejected and reported.
- **A4. Time zone.** Timestamps are treated as local branch time (Israel) and stored as-is, without time-zone conversion. DST transitions are a known limitation.

### 2.2 Upload & metadata
- **A5. Upload flow.** Upload a raw CSV → system parses and shows a **preview** → user provides/confirms **Logger ID, Branch, Fridge, Temperature unit** → system imports, normalises, analyses and stores. Nothing is stored before the user confirms.
- **A6. Preview contents.** Detected columns, total rows, valid / invalid / duplicate counts, first and last timestamp, and a sample of parsed rows.
- **A7. Fridge assignment is stored with the readings.** Each import records the Logger ID → Branch → Fridge assignment given at upload time, and every reading from that import belongs to that fridge permanently. If TL-0417 is later uploaded as Tel Aviv / Display 2, earlier readings stay with Tel Aviv / Walk-in. There is no separate assignment-management system.
- **A8. Name normalisation.** Branch and fridge names are matched case-insensitively with trimmed/collapsed whitespace (`tel aviv` = `Tel Aviv`). The first spelling used is kept for display. The upload form suggests existing branch/fridge names to reduce typos.

### 2.3 Units
- **A9. Unit is chosen by the user, never auto-detected.** Default is Celsius. Fahrenheit values are converted deterministically: `°C = (°F − 32) × 5/9`. All analysis uses Celsius.
- **A10. No suspicious-unit warning.** Considered (warning when values look implausible for the chosen unit) but intentionally left out of the MVP: the assignment gives no sufficiently defined threshold, and an invented one could produce misleading warnings. The user explicitly selects °C/°F at upload; the system never guesses or overrides that choice.
- **A11. Original values are preserved.** Each stored reading keeps its raw timestamp text, raw temperature text, the selected unit, and the normalised Celsius value.

### 2.4 Data cleaning
- **A12. Invalid readings.** Non-numeric temperatures (`ERR`, empty, etc.) are stored as invalid readings (raw text kept) and treated as **missing data** in analysis — never as 0, never silently dropped.
- **A13. Sorting.** Readings are ordered chronologically regardless of file order.
- **A14. Duplicates.** Behavioural requirement:
  - Duplicate readings within a file or across uploads are stored once; they are counted and reported in the preview/import summary. Re-uploading the same data must be safe.
  - A reading that duplicates an existing one but with a **different** value is treated as a conflict and reported to the user, not silently merged or overwritten.
  - Identity: one physical logger produces at most one reading per timestamp — `UNIQUE (logger_id, recorded_at)` (architecture §5.3).
  - **Logger IDs are normalized with trim + upper-case** before they are stored and before duplicate/conflict checks: a logger ID names a physical device, so `TL-0512` and ` tl-0512 ` are the same logger (Phase 10 decision).

### 2.5 Analysis rules
Analysis covers a fridge's full stored history, in Celsius, but each import is analysed independently: no rule looks across an import boundary (O3, §2.7).

- **A15. Threshold.** "Above five degrees" means **strictly greater than 5.0 °C**. 5.0 exactly is within limits. The threshold is a single named constant.
- **A16. Expected interval.** Not hard-coded to 15 minutes. For each import, the expected interval is the median spacing between consecutive valid timestamps — i.e. between all stored readings of that import, including invalid-temperature readings such as `ERR` (every stored reading has a valid timestamp; the logger was recording).
- **A17. Gaps.** A gap is any period between two consecutive readings (valid or invalid timestamps) longer than **2 × the expected interval**. Gaps are shown as "no data" with start, end and duration. We do not guess the cause.
  - **Decision D1 — gaps are detected within a single import only.** No gap is inferred from the time between the end of one import and the start of another. *Reason:* files are uploaded periodically, but nothing in the assignment guarantees that separate files form one continuous recording period, so we do not claim missing readings between separate uploads without evidence.
- **A18. Above-threshold runs.** Consecutive valid readings > 5.0 °C form a run.
- **A19. Isolated spike.** A run of exactly **one** reading, with a valid in-range reading immediately before and after it and no gap on either side, is classified as an **isolated spike** (possible door opening). It is shown, labelled, and kept — not alarmed as an excursion. A single high reading at the start/end of the data, or next to a gap or invalid reading, cannot be confirmed as isolated and is treated as an **excursion**.
- **A20. Excursion.** Any above-threshold run that is not an isolated spike.
  - **Start** = timestamp of the first reading > 5.0 °C.
  - **End** = timestamp of the first subsequent valid reading ≤ 5.0 °C (conservative: the fridge is not considered back in range until a reading proves it).
  - **Duration** = End − Start.
  - If no in-range reading follows, the excursion is **ongoing / open-ended**, and its duration is reported as "at least" (up to the last reading).
  - If a gap or invalid readings fall inside the excursion, it is flagged as **containing missing data** so the duration is clearly marked as uncertain.
  - Each excursion also reports its peak temperature and the readings it is based on.
- **A21. Gradual warming.** Included in the MVP. Constraints: simple, deterministic, explainable in one sentence, based only on stored readings, parameters as named constants, no AI/ML. It must distinguish a sustained rise (like Rishon's 4.6 → 5.4 → 6.3 → 7.1) from a single jump.
  - **Decision D2 — rule:** a fridge is *warming* when it has **at least 3 consecutive temperature increases** (therefore at least **4 valid readings**) and the **total increase from the first to the last of those readings is at least 1.0 °C**.
  - The sequence does not need to cross 5 °C.
  - A data gap (A17), an invalid reading (O4) or an isolated spike (A19) ends the sequence; sequences never cross imports (O3). *Spike refinement (Phase 10): realistic sample data showed a door-opening jump after two small natural rises (3.9 → 4.0 → 4.1 → 9.4) satisfying the numeric rule; a one-reading jump is not a trend, so a spike reading cannot be part of a warming sequence.*
  - *Reason:* the assignment distinguishes a one-reading jump from a slowly warming fridge but gives no numbers. The 3 increases / 1.0 °C values are an **MVP assumption to validate with Summer before production** (see §5).

### 2.6 Presentation
- **A22. Fridge status.** Each fridge gets one status for the overview, by priority: *Excursion* > *Warming* > *Data gaps* > *OK*. The overview must surface current/recent problems clearly.
  - **Decision D3 — the overview's current status is based on the fridge's latest import**, not its entire history and not an arbitrary number of days.
  - Historical problems remain visible in the fridge history/detail view; they are never deleted or hidden.
  - *Reason:* using all history could leave a fridge marked as a problem forever; a fixed window such as "last 7 days" is not supported by the assignment. The latest import is a simple, explainable boundary that follows the actual upload workflow. Details: O1, O2 (§2.7).
- **A23. Mobile-first.** The UI is designed for a phone screen first and works on desktop. Phone access to a laptop-hosted app over the local network is documented in the README.
- **A24. Single local user.** No login; data is stored locally in a file-based database.

### 2.7 Analysis boundaries and status details (decided before Phase 5)
- **O1 — Recovered excursion.** If the import that determines current status contains an excursion, the status is *Excursion* even if later readings in that same import are back to ≤ 5.0 °C. *Reason:* the excursion happened and Summer needs to see it; returning to normal does not erase the event.
- **O2 — Which import determines current status.** Recency comes from the readings' timestamps, not from `imported_at`: the import whose stored readings end latest. An import that added no new readings (e.g. a re-upload where every row was a duplicate) has no readings and therefore never changes a fridge's current status.
- **O3 — Every import is analysed independently.** Analysis sequences never join across separate imports, even for the same branch, fridge and logger: gaps, spike neighbour checks, excursions and warming sequences all stay within one import. "Start/end of the data" in A19 means the start/end of the import. An excursion still above 5 °C at the end of its import is *ongoing* for that import. *Reason:* the assignment does not guarantee that separate files form one continuous recording period; for the MVP an import is the analysis boundary.
- **O4 — Invalid readings break warming.** An invalid reading (e.g. `ERR`) ends a warming sequence; we never skip over missing or invalid readings to build a trend. *Reason:* we do not know the temperature at that moment and do not interpolate or guess missing data.

---

## 3. MVP scope

1. **Raw CSV upload** with flexible time/temperature column identification (A1–A3).
2. **Upload preview** before import, with counts and sample rows (A5–A6).
3. **Metadata entry at upload:** Logger ID, Branch, Fridge, Unit (default °C) (A5, A8, A9).
4. **Normalisation:** Fahrenheit → Celsius, timestamp parsing, chronological sorting, invalid-reading handling, duplicate/conflict handling (A9–A14).
5. **Fridge assignment preserved per import** so logger moves don't rewrite history (A7).
6. **Analysis:** gap detection, > 5 °C excursions with start/end/duration, isolated-spike classification, gradual-warming detection (A15–A21).
7. **Fridge overview:** all fridges grouped by branch, with status and problems surfaced first (A22).
8. **Fridge detail/history:** temperature chart with the 5 °C line, excursions shaded and line breaks where data is missing or invalid; findings per uploaded file — excursions answering "when above 5 °C, and for how long" (C2), warming, gaps and spikes; all readings with raw values.
9. **Mobile-friendly UI** (A23).
10. **Local persistence** — no accounts, no paid services (A24).
11. **Tests** covering parsing, normalisation and analysis rules, using sample-data scenarios derived from the assignment (Haifa °F + `ERR`, Tel Aviv spike, Rishon slow warming, Jerusalem duplicate + gap, TL-0417 move).
12. **Generated sample raw logger files** covering the above scenarios.
13. **README.md** and **NOTES.md** as required by the assignment.

---

## 4. Out of scope (MVP)

- Authentication / multiple users.
- Notifications or alerts (email, SMS, push).
- Deployment or hosting.
- Export / print of reports.
- Logger-to-fridge assignment management (beyond recording the assignment given at each upload).
- Automatic unit detection and suspicious-unit warnings (A9, A10).
- AI/ML or statistical anomaly detection.
- Too-cold / freezing detection.
- Time-zone and DST handling.
- Editing or deleting imported readings through the UI.
- Excel (`.xlsx`) upload — CSV only.
- Any infrastructure beyond what is needed to run locally.

---

## 5. Open questions for Summer

1. **How do you currently know which logger/fridge an incoming file belongs to?** Is the logger ID encoded in the filename, known from the sender, or determined another way? (Could let us pre-fill metadata instead of typing it.)
2. Can you send one real raw file from each logger model (especially the Haifa one), so we can confirm columns, date formats and units?
3. Is the Haifa logger definitely recording in Fahrenheit? Are any other loggers?
4. What is the loggers' recording interval? (The sample suggests 15 minutes, but ~3,000 rows/week across ~12 branches suggests a longer interval or fewer fridges.)
5. Is 5 °C the limit for every fridge, or do some (e.g. display fridges, cream cakes) have different limits? Does the inspector care about "above 5" or "5 and above"?
6. How long must temperature history be kept for the Ministry of Health?
7. What does the inspector need to receive — a verbal answer, a printed report, a file?
8. When a logger is moved to another fridge, how and when do you find out?
9. Would you want an alert (e.g. email/WhatsApp) when a problem is detected, and to whom? Note that with weekly uploads, a slow failure like Rishon's could still be found days late — would branches be willing to upload more often?
10. Do you also care about fridges that get too cold?
11. Is there anyone else (branch managers) who should see this, or just you?
12. Our "warming" rule flags at least 3 consecutive increases totalling at least 1.0 °C (D2). Does that match what you would call "slowly warming up"? What does a normal day look like for these fridges (defrost cycles, busy hours)?
13. Does each weekly file contain everything since the previous download, or can there be periods that are never uploaded?
14. Do the logger files always start with a header row (e.g. `Time,Temp`)? Header-less files are not supported in the MVP.
