const STOCKHOLM_TIME_ZONE = "Europe/Stockholm";

const STOCKHOLM_DATE_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: STOCKHOLM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function isValidDateInstance(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function normalizeDateInput(value) {
  if (isValidDateInstance(value)) return value;
  const parsed = new Date(value);
  return isValidDateInstance(parsed) ? parsed : null;
}

export function stockholmDateKey(value = new Date()) {
  const date = normalizeDateInput(value);
  if (!date) return null;
  return STOCKHOLM_DATE_FORMATTER.format(date);
}

export function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!isValidDateInstance(parsed)) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

export function isPastStockholmDate(dateKey, now = new Date()) {
  if (!isDateKey(dateKey)) return false;
  const today = stockholmDateKey(now);
  return Boolean(today && dateKey < today);
}

export function assertPastStockholmDate(dateKey, now = new Date()) {
  if (!isDateKey(dateKey)) {
    throw new Error("Ogiltigt datum för rättning.");
  }
  if (!isPastStockholmDate(dateKey, now)) {
    throw new Error("Rättning är bara tillgänglig när dagens datum är senare än matchens datum.");
  }
  return dateKey;
}

