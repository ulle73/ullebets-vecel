/**
 * @fileoverview Snapshots repository - standardized snapshot schema and I/O.
 * Handles reading/writing bet snapshots to MongoDB.
 * 
 * @module lib/repos/snapshots
 */

import { clientPromise } from "../db.js";
import { buildSnapshotTimingFields } from "./snapshotFields.js";

const DB = process.env.MONGODB_DB || "app";
const DEFAULT_COLLECTION = "unibet-backtest";

/**
 * Standard snapshot schema for bet data.
 * 
 * @typedef {Object} SnapshotDocument
 * @property {string} _id - Unique identifier (usually slug)
 * @property {string} date - YYYY-MM-DD
 * @property {string} type - Snapshot type ('backtest'|'forward'|'closing'|'ai-user')
 * @property {Array} snapshots - Array of snapshot entries
 * @property {string} slug - Match slug
 * @property {string} eventId - Unibet event ID
 * @property {string} matchId - Match ID
 * @property {string} matchDate - Match date
 * @property {string} url - Unibet URL
 * @property {string} league - League name
 * @property {string} homeTeam - Home team name
 * @property {string} awayTeam - Away team name
 */

/**
 * Write a snapshot to MongoDB.
 * Creates or updates a document with the snapshot data.
 * 
 * @param {Object} params - Snapshot parameters
 * @param {string} [params.collection] - MongoDB collection (default: 'unibet-backtest')
 * @param {string} params.id - Document ID (usually slug)
 * @param {string} params.type - Snapshot type ('backtest'|'forward'|'closing'|'ai-user')
 * @param {string} params.date - YYYY-MM-DD
 * @param {Array} params.lines - Array of bet lines with betKeys
 * @param {Object} [params.metadata] - Additional metadata
 * @param {number} [params.snapshotLimit] - Max snapshots to keep (default: 10)
 * @returns {Promise<Object>} Result from MongoDB update
 * 
 * @example
 * await writeSnapshot({
 *   id: "arsenal-chelsea-2024-11-28",
 *   type: "backtest",
 *   date: "2024-11-28",
 *   lines: [{ betKey: "...", odds: 1.85, value: 0.15, ... }],
 *   metadata: { eventId: "123", homeTeam: "Arsenal", awayTeam: "Chelsea" }
 * });
 */
export async function writeSnapshot(params) {
  const {
    collection = DEFAULT_COLLECTION,
    id,
    type,
    date,
    lines,
    metadata = {},
    snapshotLimit = 10,
  } = params;

  if (!id) throw new Error("Snapshot ID is required");
  if (!type) throw new Error("Snapshot type is required");
  if (!date) throw new Error("Snapshot date is required");
  if (!Array.isArray(lines)) throw new Error("Lines must be an array");

  const client = await clientPromise;
  const db = client.db(DB);
  const col = db.collection(collection);

  const timing = buildSnapshotTimingFields({
    matchDate: metadata.matchDate,
    capturedAt: metadata.capturedAt,
    checkpointKey: metadata.checkpointKey,
    minutesToKickoff: metadata.minutesToKickoff,
  });

  const snapshot = {
    type,
    runDate: date,
    lines,
    ...metadata,
    fetchedAt: timing.capturedAtDate,
    capturedAt: timing.capturedAtDate,
    horizonDays: timing.horizonDays,
    minutesToKickoff: timing.minutesToKickoff,
  };

  // CRITICAL: User wants latest lines at root level too
  const baseFields = {
    slug: id,
    matchDate: metadata.matchDate || date,
    lines, // Save latest lines to root
    ...metadata,
    capturedAt: timing.capturedAtDate,
    minutesToKickoff: timing.minutesToKickoff,
    horizonDays: timing.horizonDays,
  };

  const result = await col.updateOne(
    { _id: id },
    {
      $setOnInsert: { generatedAt: new Date().toISOString() },
      // Always bump updatedAt so callers can sort for latest writes
      $set: { ...baseFields, updatedAt: new Date() },
      $push: {
        snapshots: {
          $each: [snapshot],
          $slice: -snapshotLimit, // Keep only last N snapshots
        },
      },
    },
    { upsert: true }
  );

  return result;
}

/**
 * Read all snapshots for a document.
 * 
 * @param {string} collection - MongoDB collection
 * @param {string} id - Document ID
 * @param {Object} [options] - Options
 * @param {number} [options.limit] - Max snapshots to return
 * @returns {Promise<Array>} Array of snapshots
 * 
 * @example
 * const snapshots = await readSnapshots("unibet-backtest", "arsenal-chelsea-2024-11-28");
 */
export async function readSnapshots(collection, id, options = {}) {
  if (!collection || !id) return [];

  const { limit } = options;

  try {
    const client = await clientPromise;
    const db = client.db(DB);
    const col = db.collection(collection);

    const doc = await col.findOne({ _id: id });
    if (!doc || !Array.isArray(doc.snapshots)) return [];

    let snapshots = doc.snapshots;

    if (limit && limit > 0) {
      snapshots = snapshots.slice(-limit); // Get last N snapshots
    }

    return snapshots;
  } catch (error) {
    console.error(`[repo:snapshots] readSnapshots error:`, error.message);
    return [];
  }
}

/**
 * Read the latest snapshot for a document.
 * 
 * @param {string} collection - MongoDB collection
 * @param {string} id - Document ID
 * @returns {Promise<Object|null>} Latest snapshot or null
 * 
 * @example
 * const latest = await readLatestSnapshot("unibet-backtest", "arsenal-chelsea-2024-11-28");
 */
export async function readLatestSnapshot(collection, id) {
  const snapshots = await readSnapshots(collection, id, { limit: 1 });
  return snapshots.length > 0 ? snapshots[0] : null;
}

/**
 * Read entire snapshot document (including all fields).
 * 
 * @param {string} collection - MongoDB collection
 * @param {string} id - Document ID
 * @returns {Promise<Object|null>} Full document or null
 * 
 * @example
 * const doc = await readSnapshotDocument("unibet-backtest", "arsenal-chelsea-2024-11-28");
 * // Returns: { _id, slug, matchDate, eventId, snapshots: [...], ... }
 */
export async function readSnapshotDocument(collection, id) {
  if (!collection || !id) return null;

  try {
    const client = await clientPromise;
    const db = client.db(DB);
    const col = db.collection(collection);

    return await col.findOne({ _id: id });
  } catch (error) {
    console.error(`[repo:snapshots] readSnapshotDocument error:`, error.message);
    return null;
  }
}

/**
 * Delete old snapshots beyond a certain date.
 * Useful for cleanup operations.
 * 
 * @param {string} collection - MongoDB collection
 * @param {string} beforeDate - Delete snapshots before this date (YYYY-MM-DD)
 * @returns {Promise<number>} Number of documents deleted
 */
export async function deleteOldSnapshots(collection, beforeDate) {
  if (!collection || !beforeDate) return 0;

  try {
    const client = await clientPromise;
    const db = client.db(DB);
    const col = db.collection(collection);

    const result = await col.deleteMany({
      matchDate: { $lt: beforeDate },
    });

    return result.deletedCount || 0;
  } catch (error) {
    console.error(`[repo:snapshots] deleteOldSnapshots error:`, error.message);
    return 0;
  }
}
