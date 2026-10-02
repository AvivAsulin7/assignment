/**
 * Normalised key used to match branch and fridge names entered by hand
 * (requirements A8): trimmed, inner whitespace collapsed, lower-cased.
 * "tel aviv", "Tel Aviv" and " Tel  Aviv " all map to "tel aviv".
 */
export function toNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
