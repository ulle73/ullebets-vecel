import test from "node:test";
import assert from "node:assert/strict";

import {
  assertPastStockholmDate,
  isPastStockholmDate,
  stockholmDateKey,
} from "./lib/stockholmDate.js";

test("stockholmDateKey använder svensk kalenderdag även nära UTC-skifte", () => {
  assert.equal(stockholmDateKey("2026-05-14T22:30:00.000Z"), "2026-05-15");
});

test("isPastStockholmDate tillåter bara datum före dagens stockholmsdatum", () => {
  const now = new Date("2026-05-15T08:00:00+02:00");

  assert.equal(isPastStockholmDate("2026-05-14", now), true);
  assert.equal(isPastStockholmDate("2026-05-15", now), false);
  assert.equal(isPastStockholmDate("2026-05-16", now), false);
});

test("assertPastStockholmDate kastar för dagens datum och framtida datum", () => {
  const now = new Date("2026-05-15T08:00:00+02:00");

  assert.equal(assertPastStockholmDate("2026-05-14", now), "2026-05-14");
  assert.throws(() => assertPastStockholmDate("2026-05-15", now), /senare än matchens datum/i);
  assert.throws(() => assertPastStockholmDate("2026-05-16", now), /senare än matchens datum/i);
});
