import "server-only";
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
