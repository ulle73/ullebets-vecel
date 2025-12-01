/**
 * Date utilities shared across scripts/APIs.
 * Converts mixed inputs (ISO strings, numbers, timestamps in seconds/ms) into YYYY-MM-DD.
 */

export function toDateStr(value) {
  if (value == null) return null;

  // Accept Date instance directly
  if (value instanceof Date) {
    const ts = value.getTime();
    if (Number.isNaN(ts)) return null;
    return value.toISOString().split("T")[0];
  }

  // Numbers: could be ms or seconds
  if (typeof value === "number") {
    const ts = value < 2e12 ? value * 1000 : value; // heuristic: treat < ~2033 as seconds
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
  }

  // Strings: try as-is, or numeric-ish
  const str = String(value).trim();
  if (!str) return null;

  const num = Number(str);
  if (Number.isFinite(num)) {
    const ts = num < 2e12 ? num * 1000 : num;
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
  }

  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

/**
 * Safe Date factory: returns null if invalid.
 */
export function toDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
