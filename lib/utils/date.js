// import "server-only"; // Commented out for standalone testing
import { DateTime } from "luxon";

const TZ = "Europe/Stockholm";

/**
 * Nu i svensk tid (Luxon DateTime)
 */
export function nowSE() {
  return DateTime.now().setZone(TZ);
}

/**
 * YYYY-MM-DD för "idag" i svensk tid
 */
export function todaySE() {
  return nowSE().toFormat("yyyy-LL-dd");
}

export function tomorrowSE() {
  return nowSE().plus({ days: 1 }).toFormat("yyyy-LL-dd");
}

/**
 * Konvertera valfritt datum/timestamp till YYYY-MM-DD i svensk tid
 * @param {string|number|Date} input
 */
export function toYMD_SE(input) {
  return DateTime.fromJSDate(new Date(input)).setZone(TZ).toFormat("yyyy-LL-dd");
}

/**
 * Start/slut på dag i svensk tid — returnerar UTC Date (den faktiska tidpunkten)
 * @param {string|number|Date} input (valfritt; default idag)
 */
export function startOfDaySE(input = undefined) {
  const dt = input ? DateTime.fromJSDate(new Date(input)).setZone(TZ) : nowSE();
  return dt.startOf("day").toUTC().toJSDate();
}

export function endOfDaySE(input = undefined) {
  const dt = input ? DateTime.fromJSDate(new Date(input)).setZone(TZ) : nowSE();
  return dt.endOf("day").toUTC().toJSDate();
}

/**
 * Praktiskt spann för en dag i svensk tid (UTC Dates)
 */
export function dayRangeSE(input = undefined) {
  return { from: startOfDaySE(input), to: endOfDaySE(input) };
}

/**
 * Formattera datum/tid i svensk stil
 * @param {string|number|Date} input
 * @param {Object} opts Luxon-format options (default: "yyyy-LL-dd HH:mm")
 */
export function formatSE(input, fmt = "yyyy-LL-dd HH:mm") {
  return DateTime.fromJSDate(new Date(input)).setZone(TZ).toFormat(fmt);
}

/**
 * Är given UTC-tid "idag" i svensk kalender?
 */
export function isTodaySE(input) {
  const d = DateTime.fromJSDate(new Date(input)).setZone(TZ);
  const n = nowSE();
  return d.hasSame(n, "day");
}

/**
 * Konvertera svensk väggtid (YYYY-MM-DD HH:mm) till UTC Date
 * @param {string} ymd "YYYY-MM-DD"
 * @param {string} hm  "HH:mm" (valfritt, default "00:00")
 */
export function seWallTimeToUTC(ymd, hm = "00:00") {
  const dt = DateTime.fromFormat(`${ymd} ${hm}`, "yyyy-LL-dd HH:mm", { zone: TZ });
  if (!dt.isValid) throw new Error(`Invalid SE wall time: ${ymd} ${hm}`);
  return dt.toUTC().toJSDate();
}

/**
 * Coerce various input types to a Date object.
 * Handles timestamps (seconds or milliseconds), strings, and Date objects.
 * 
 * From: scripts/run-unibet-backtests.js
 * 
 * @param {string|number|Date|null} value - Value to coerce
 * @returns {Date|null} Date object or null if invalid
 * 
 * @example
 * coerceDate(1701187200) // Unix timestamp in seconds
 * coerceDate(1701187200000) // Unix timestamp in milliseconds  
 * coerceDate("2024-11-28") // ISO string
 * coerceDate(new Date()) // Date object
 */
export function coerceDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000; // Convert seconds to ms if needed
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    
    // Handle numeric strings (timestamps)
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      const ms = num > 1e12 ? num : num * 1000;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Format a date as YYYY-MM-DD in a specific timezone using Intl.DateTimeFormat.
 * 
 * From: scripts/run-unibet-backtests.js
 * Note: This is an alternative to toYMD_SE that uses Intl instead of Luxon.
 * 
 * @param {string|number|Date} dateLike - Date value
 * @param {string} timeZone - IANA timezone (default: "Europe/Stockholm")
 * @returns {string} YYYY-MM-DD formatted date
 * 
 * @example
 * formatDateInZone(new Date(), "Europe/Stockholm") // "2024-11-28"
 * formatDateInZone(1701187200000, "UTC") // "2023-11-28"
 */
export function formatDateInZone(dateLike, timeZone = TZ) {
  const date = coerceDate(dateLike);
  if (!date) return "";
  
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * Check if two dates are the same day in a specific timezone.
 * 
 * From: scripts/run-unibet-backtests.js
 * 
 * @param {string|number|Date} dateA - First date
 * @param {string|number|Date} dateB - Second date  
 * @param {string} timeZone - IANA timezone (default: "Europe/Stockholm")
 * @returns {boolean} True if same day in the given timezone
 * 
 * @example
 * isSameDay("2024-11-28T00:00:00Z", "2024-11-28T23:59:59Z", "Europe/Stockholm")
 */
export function isSameDay(dateA, dateB, timeZone = TZ) {
  if (!dateA || !dateB) return false;
  const normalizedA = formatDateInZone(dateA, timeZone);
  const normalizedB = formatDateInZone(dateB, timeZone);
  if (!normalizedA || !normalizedB) return false;
  return normalizedA === normalizedB;
}

/**
 * Format a Date as YYYY-MM-DD in UTC timezone.
 * 
 * From: scripts/update-teams-v2.js
 * 
 * @param {Date} date - Date object
 * @returns {string} YYYY-MM-DD in UTC
 * 
 * @example
 * ymdUTC(new Date("2024-11-28T10:30:00Z")) // "2024-11-28"
 */
export function ymdUTC(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Add days to a Date in UTC (preserves UTC date).
 * 
 * From: scripts/update-teams-v2.js
 * 
 * @param {Date} date - Starting date
 * @param {number} days - Number of days to add (can be negative)
 * @returns {Date} New Date object
 * 
 * @example
 * addDaysUTC(new Date("2024-11-28T00:00:00Z"), 1) // 2024-11-29
 * addDaysUTC(new Date("2024-11-28T00:00:00Z"), -1) // 2024-11-27
 */
export function addDaysUTC(date, days) {
  const copy = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/**
 * Strictly parse a YYYY-MM-DD string to a UTC Date.
 * Returns null if the format is invalid or the date is invalid.
 * 
 * From: scripts/update-teams-v2.js
 * 
 * @param {string} value - Date string in YYYY-MM-DD format
 * @returns {Date|null} UTC Date object or null if invalid
 * 
 * @example
 * parseYmdStrict("2024-11-28") // Valid Date
 * parseYmdStrict("2024-02-30") // null (invalid date)
 * parseYmdStrict("2024-11-8") // null (wrong format, must be 2-digit)
 */
export function parseYmdStrict(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  
  const [year, month, day] = value
    .split("-")
    .map((segment) => parseInt(segment, 10));
  
  const dt = new Date(Date.UTC(year, month - 1, day));
  
  // Verify that the date didn't roll over (e.g., Feb 30 -> Mar 2)
  return ymdUTC(dt) === value ? dt : null;
}
