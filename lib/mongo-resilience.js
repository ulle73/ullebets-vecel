import { MongoClient } from "mongodb";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientMongoShutdownError(error) {
  const code = Number(error?.code);
  const codeName = error?.codeName || error?.errorResponse?.codeName;
  const message = String(error?.message || error?.errmsg || "");
  const labels = error?.errorLabels || error?.errorLabelSet;
  const hasResetPoolLabel =
    labels && typeof labels?.has === "function" ? labels.has("ResetPool") : false;

  return (
    code === 91 ||
    codeName === "ShutdownInProgress" ||
    /shutdown on the server/i.test(message) ||
    hasResetPoolLabel
  );
}

export async function retryTransientMongoOperation(
  label,
  operation,
  {
    retries = 3,
    delayMs = 1000,
    logger = console,
  } = {}
) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await operation({ attempt });
    } catch (error) {
      lastError = error;
      if (!isTransientMongoShutdownError(error) || attempt === retries) {
        throw error;
      }

      const waitMs = delayMs * attempt;
      logger.warn?.(
        `[mongo] ${label} transient failure (attempt ${attempt}/${retries}): ${error?.message || error}; retrying in ${waitMs}ms`
      );
      await sleep(waitMs);
    }
  }

  throw lastError;
}

export async function withMongoClientRetry(
  {
    uri,
    dbName,
    label = "mongo operation",
    retries = 3,
    delayMs = 1000,
    logger = console,
  },
  operation
) {
  if (!uri) {
    throw new Error("MONGODB_URI missing");
  }

  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const client = new MongoClient(uri);
    try {
      await client.connect();
      const db = client.db(dbName);
      return await operation({ client, db, attempt });
    } catch (error) {
      lastError = error;
      if (!isTransientMongoShutdownError(error) || attempt === retries) {
        throw error;
      }

      const waitMs = delayMs * attempt;
      logger.warn?.(
        `[mongo] ${label} transient failure (attempt ${attempt}/${retries}): ${error?.message || error}; reconnecting in ${waitMs}ms`
      );
      await sleep(waitMs);
    } finally {
      await client.close(true).catch(() => {});
    }
  }

  throw lastError;
}
