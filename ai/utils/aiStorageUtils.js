/**
 * Utility functions for persisting AI-generated betting results in localStorage
 */

const STORAGE_PREFIX = "ai_bet_results_";

/**
 * Generates a storage key for a specific date
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {string} Storage key
 */
function getStorageKey(date) {
  return `${STORAGE_PREFIX}${date}`;
}

/**
 * Saves generated betting results for a specific date
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {object} data - Data to save
 * @param {object} data.positiveLineMap - Map of positive betting lines
 * @param {object} data.completedMatches - Map of completed match analyses
 * @param {array} data.topOverRows - Top over betting rows
 * @param {array} data.topUnderRows - Top under betting rows
 * @param {object} data.matchupsData - Full matchups data
 */
export function saveGeneratedResults(date, data) {
  if (typeof window === "undefined" || !date || !data) {
    return;
  }

  try {
    const storageData = {
      date,
      timestamp: Date.now(),
      positiveLineMap: data.positiveLineMap || {},
      completedMatches: data.completedMatches || {},
      topOverRows: data.topOverRows || [],
      topUnderRows: data.topUnderRows || [],
      matchupsData: data.matchupsData || null,
    };

    const key = getStorageKey(date);
    localStorage.setItem(key, JSON.stringify(storageData));
    
    console.log(`[AI Storage] Saved results for ${date}`);
  } catch (error) {
    console.error("[AI Storage] Failed to save results:", error);
  }
}

/**
 * Loads generated betting results for a specific date
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {object|null} Saved data or null if not found
 */
export function loadGeneratedResults(date) {
  if (typeof window === "undefined" || !date) {
    return null;
  }

  try {
    const key = getStorageKey(date);
    const stored = localStorage.getItem(key);
    
    if (!stored) {
      return null;
    }

    const data = JSON.parse(stored);
    
    // Validate that the data is for the correct date
    if (data.date !== date) {
      console.warn(`[AI Storage] Date mismatch for key ${key}`);
      return null;
    }

    console.log(`[AI Storage] Loaded results for ${date} (saved ${new Date(data.timestamp).toLocaleString()})`);
    return data;
  } catch (error) {
    console.error("[AI Storage] Failed to load results:", error);
    return null;
  }
}

/**
 * Clears generated betting results for a specific date
 * @param {string} date - Date in YYYY-MM-DD format
 */
export function clearGeneratedResults(date) {
  if (typeof window === "undefined" || !date) {
    return;
  }

  try {
    const key = getStorageKey(date);
    localStorage.removeItem(key);
    console.log(`[AI Storage] Cleared results for ${date}`);
  } catch (error) {
    console.error("[AI Storage] Failed to clear results:", error);
  }
}

/**
 * Gets all stored dates
 * @returns {string[]} Array of dates that have stored results
 */
export function getStoredDates() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const dates = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        const date = key.replace(STORAGE_PREFIX, "");
        dates.push(date);
      }
    }
    return dates;
  } catch (error) {
    console.error("[AI Storage] Failed to get stored dates:", error);
    return [];
  }
}
