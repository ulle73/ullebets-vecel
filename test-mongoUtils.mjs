import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMongoUpsertDocument,
  connectMongoClientWithRetry,
  isRetryableMongoError,
  runMongoWithRetry,
} from "./lib/mongoUtils.js";

test("buildMongoUpsertDocument moves createdAt to $setOnInsert", () => {
  const createdAt = new Date("2026-05-22T05:45:00.000Z");
  const updatedAt = new Date("2026-05-22T05:46:00.000Z");
  const update = buildMongoUpsertDocument({
    runId: "2026-05-25:balanced:d3",
    createdAt,
    updatedAt,
    analyzedMatches: 12,
  });

  assert.deepEqual(update.$set, {
    runId: "2026-05-25:balanced:d3",
    updatedAt,
    analyzedMatches: 12,
  });
  assert.deepEqual(update.$setOnInsert, { createdAt });
  assert.equal("createdAt" in update.$set, false);
});

test("runMongoWithRetry retries ShutdownInProgress errors", async () => {
  let attempts = 0;
  const result = await runMongoWithRetry(
    "unit test",
    async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("Request terminated due to shutdown on the server.");
        error.code = 91;
        error.codeName = "ShutdownInProgress";
        throw error;
      }
      return "ok";
    },
    { attempts: 2, baseDelayMs: 1 },
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
  assert.equal(
    isRetryableMongoError({
      name: "MongoServerSelectionError",
      errorLabelSet: new Set(),
    }),
    true,
  );
});

test("connectMongoClientWithRetry retries connection failures with fresh clients", async () => {
  let attempts = 0;
  const clients = [];
  const client = await connectMongoClientWithRetry("mongodb://example.test", {
    attempts: 2,
    baseDelayMs: 1,
    clientFactory: () => {
      attempts += 1;
      const fakeClient = {
        closed: false,
        async connect() {
          if (attempts === 1) {
            const error = new Error("selection timeout");
            error.name = "MongoServerSelectionError";
            throw error;
          }
        },
        async close() {
          fakeClient.closed = true;
        },
      };
      clients.push(fakeClient);
      return fakeClient;
    },
  });

  assert.equal(attempts, 2);
  assert.equal(client, clients[1]);
  assert.equal(clients[0].closed, true);
  assert.equal(clients[1].closed, false);
});
