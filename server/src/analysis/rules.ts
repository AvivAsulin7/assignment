/**
 * Business thresholds for temperature analysis (docs/requirements.md §2.5–2.7).
 * Every rule parameter lives here.
 */

/** "Above five degrees" means strictly greater than 5.0 °C; exactly 5.0 is in range (A15). */
export const THRESHOLD_C = 5.0;

/** A gap is a spacing longer than this many expected intervals (A17). */
export const GAP_INTERVAL_MULTIPLIER = 2;

/**
 * Gradual warming (A21, D2): at least this many consecutive increases
 * (so one more valid reading) …
 * MVP assumption — to validate with Summer before production.
 */
export const WARMING_MIN_INCREASES = 3;

/** … with at least this total rise from the first to the last reading (°C). MVP assumption. */
export const WARMING_MIN_RISE_C = 1.0;
