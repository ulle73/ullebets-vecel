import { MongoClient } from "mongodb";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorLabels(error) {
  if (error?.errorLabelSet instanceof Set) {
    return error.errorLabelSet;
  }
  if (Array.isArray(error?.errorLabels)) {
    return new Set(error.errorLabels);
  }
  return new Set();
}

export function buildMongoClientOptions() {
  return {
    retryReads: true,
    retryWrites: true,
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 45_000,
    connectTimeoutMS: 30_000,
    socketTimeoutMS: 120_000,
    heartbeatFrequencyMS: 10_000,
  };
}

export function isRetryableMongoError(error) {
  if (!error) return false;

  const code = Number(error.code);
  const codeName = String(error.codeName || "");
  const name = String(error.name || "");
  const message = String(error.message || "");
  const labels = getErrorLabels(error);

  if (code === 91 || codeName === "ShutdownInProgress") {
    return true;
  }

  if (
    name === "MongoNetworkError" ||
    name === "MongoNetworkTimeoutError" ||
    name === "MongoServerSelectionError" ||
    name === "MongoTopologyClosedError" ||
    name === "MongoPoolClearedError" ||
    name === "PoolClearedOnNetworkError"
  ) {
    return true;
  }

  if (
    labels.has("RetryableWriteError") ||
    labels.has("TransientTransactionError") ||
    labels.has("ResetPool") ||
    labels.has("HandshakeError") ||
    labels.has("PoolRequstedRetry")
  ) {
    return true;
  }

  return (
    message.includes("ECONNRESET") ||
    message.includes("connection") ||
    message.includes("shutdown on the server") ||
    message.includes("server selection")
  );
}

export async function runMongoWithRetry(
  label,
  fn,
  { attempts = 5, baseDelayMs = 2_000 } = {},
) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableMongoError(error) || attempt === attempts) {
        throw error;
      }
      const waitMs = baseDelayMs * attempt;
      console.warn(
        `[mongo] ${label} failed with ${error.name || "Error"}; retrying in ${waitMs}ms (${attempt}/${attempts})`,
      );
      await sleep(waitMs);
    }
  }

  throw lastError;
}

export async function connectMongoClientWithRetry(
  mongoUri,
  {
    attempts = 5,
    baseDelayMs = 2_000,
    clientFactory = (uri, options) => new MongoClient(uri, options),
  } = {},
) {
  return runMongoWithRetry(
    "mongodb connect",
    async () => {
      const client = clientFactory(mongoUri, buildMongoClientOptions());
      try {
        await client.connect();
        return client;
      } catch (error) {
        await client.close().catch(() => {});
        throw error;
      }
    },
    { attempts, baseDelayMs },
  );
}

export function buildMongoUpsertDocument(doc = {}, { createdAtFallback = new Date() } = {}) {
  const { createdAt, ...setDoc } = doc || {};
  return {
    $set: setDoc,
    $setOnInsert: {
      createdAt: createdAt instanceof Date ? createdAt : createdAtFallback,
    },
  };
}
