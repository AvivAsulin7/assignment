# CLAUDE.md

Instructions for Claude Code when working in this repository.

## 1. Project context

- 48-hour take-home MVP for Triolla: a tool for Squanchy Bakery's operations manager to upload weekly fridge temperature-logger CSV files, see how every fridge is doing, and answer the health inspector's question: *"when did this fridge go above 5 °C, and for how long?"*
- Simplicity, correctness and explainability matter more than feature count.
- Source of truth — **read before making significant changes**:
  - [`docs/requirements.md`](docs/requirements.md) — product requirements, assumptions (A1…A24), MVP scope, out of scope, open questions.
  - [`docs/architecture.md`](docs/architecture.md) — architecture, modules, data model, API, testing strategy, technology choices, unresolved decisions.

## 2. Scope discipline

- Do not add features outside the documented MVP unless explicitly requested.
- Do not introduce unnecessary infrastructure, abstractions or dependencies.
- Do not silently change documented product or architecture decisions.
- If implementation shows a documented decision needs to change, explain why and get agreement before changing it (and update the relevant doc).

## 3. Architecture rules

- Keep HTTP handlers thin: validate, delegate to a service, shape the response.
- Keep parsing, normalization, analysis and persistence in their separate modules (see `docs/architecture.md` §3).
- Temperature analysis is implemented as pure, deterministic functions.
- Analysis code must not depend on HTTP, Express, React, the database, or the system clock (pass "now"/time windows in as arguments).
- Analysis operates only on normalized Celsius values.
- Derived findings (excursions, spikes, gaps, warming, status) are computed from readings on read and are never persisted.
- Preserve original raw input values (raw file, raw timestamp, raw temperature) for traceability.
- Keep the frontend simple; no global state management unless a real need appears.

## 4. Business-rule discipline

- Never silently delete, modify or hide source readings.
- Invalid readings (e.g. `ERR`) must remain stored and traceable; they are treated as missing data, never as a value.
- Do not guess or interpolate missing data.
- No AI/ML for runtime temperature classification.
- Business rules must be deterministic and explainable in plain language.
- Named thresholds and parameters live in the analysis rules/constants file, not scattered through the code.

### Unresolved decisions — do not invent answers

Currently unresolved (see `docs/architecture.md` §12):

- the exact gradual-warming rule
- the time window used for overview status
- gap behavior between separate weekly imports

**Do not invent or silently resolve a documented TBD.** If a task requires one of these decisions, stop and surface the decision to the user before implementing that behavior. Once decided, record it in the docs.

## 5. Testing rules

- Every business-rule change requires tests.
- Prioritize unit tests for parsing, normalization and analysis.
- Use the assignment's scenarios as test cases where appropriate (Haifa °F + `ERR`, Tel Aviv one-reading spike, Rishon slow warming, Jerusalem duplicate + gap, TL-0417 moved between fridges).
- Add integration tests (Supertest + in-memory SQLite) when behavior crosses API/persistence boundaries.
- Run the relevant tests after implementing and report failures honestly — never hide, skip or weaken tests.
- Never change a test just to make a failing implementation pass without understanding why it failed.

## 6. Working style

- Make small, reviewable changes.
- Before a substantial implementation, briefly state the intended approach.
- After a change, summarize what changed and what was tested.
- Do not modify unrelated files.
- Prefer existing project patterns over introducing new ones.
- If the repository contradicts `docs/requirements.md` or `docs/architecture.md`, surface the contradiction instead of guessing.
- No speculative abstractions for hypothetical future requirements.

## 7. AI/process traceability

The assignment asks us to explain how AI tools were used, so the process should be visible:

- Clearly call out any non-obvious assumption, architectural change or trade-off Claude proposes, so it can be reviewed.
- Do not hide uncertainty — say when something is a guess or unverified.
- Make reasoning and rejected alternatives visible (in the conversation, commit messages, or docs/notes) rather than silently choosing.
