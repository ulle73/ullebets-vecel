/**
 * @fileoverview Team and league name normalization utilities.
 * Consolidates all name normalization, variant generation, and alias resolution.
 * 
 * CRITICAL: These normalizations are used for matching teams across different data sources
 * (Unibet, SofaScore, database, etc.). Changes can break existing matches.
 * 
 * @module lib/core/normalization
 */

/**
 * Normalizes a team name to a consistent lowercase format.
 * Removes diacritics, special characters, and extra whitespace.
 * 
 * @param {string} name - Team name to normalize
 * @returns {string} Normalized team name
 * 
 * @example
 * normalizeTeamName("FC Bayern München") // Returns: "fc bayern munchen"
 * normalizeTeamName("Arsenal") // Returns: "arsenal"
 */
export function normalizeTeamName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // Remove diacritics (ä, ö, etc.)
    .replace(/&/g, "and")
    .replace(/[''`]/g, "") // Remove apostrophes/quotes
    .replace(/[^a-z0-9]+/g, " ") // Replace non-alphanumeric with spaces
    .trim();
}

/**
 * Normalizes a league name, also removing year patterns.
 * 
 * @param {string} name - League name to normalize
 * @returns {string} Normalized league name
 * 
 * @example
 * normalizeLeagueName("Premier League 2023/24") // Returns: "premier league"
 * normalizeLeagueName("Serie A") // Returns: "serie a"
 */
export function normalizeLeagueName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/\d{4}\/\d{2}|\d{2}\/\d{2}/g, "") // Remove year patterns like 2023/24
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Generates name variants for fuzzy matching.
 * Creates variations by removing common prefixes, replacing characters, etc.
 * 
 * @param {string} name - Name to generate variants for
 * @returns {Set<string>} Set of name variants
 * 
 * @example
 * generateNameVariants("Arsenal FC")
 * // Returns: Set(["Arsenal FC", "Arsenal  ", "Arsenal and C", ...])
 */
export function generateNameVariants(name) {
  const variants = new Set();
  if (!name) return variants;
  
  variants.add(name);
  variants.add(name.replace(/-/g, " ")); // Hyphens to spaces
  variants.add(name.replace(/&/g, "and")); // & to "and"
  variants.add(name.replace(/[.]/g, "")); // Remove periods
  variants.add(name.replace(/\b(?:FC|CF|AC|AFC|Club|The)\b/gi, "").trim()); // Remove common prefixes
  
  return new Set(Array.from(variants).filter(Boolean));
}

/**
 * Generates league name variants, removing year patterns.
 * 
 * @param {string} name - League name to generate variants for
 * @returns {string[]} Array of league name variants
 * 
 * @example
 * generateLeagueVariants("Premier League 2023-24")
 * // Returns: ["Premier League 2023-24", "Premier League", ...]
 */
export function generateLeagueVariants(name) {
  const variants = new Set([name]);
  
  variants.add(name.replace(/\d{4}-\d{2}/g, "")); // Remove 2023-24
  variants.add(name.replace(/\d{4}\/\d{2}/g, "")); // Remove 2023/24
  variants.add(name.replace(/\d{2}\/\d{2}/g, "")); // Remove 23/24
  variants.add(name.replace(/\d{4}-\d{4}/g, "")); // Remove 2023-2024
  variants.add(name.replace(/-/g, " ")); // Hyphens to spaces
  
  return Array.from(
    new Set(
      Array.from(variants)
        .map((v) => v.trim())
        .filter(Boolean)
    )
  );
}

/**
 * Builds an alias map from leagues data and custom aliases.
 * Maps normalized team names to their canonical names.
 * 
 * @param {Object} leaguesData - Leagues data from leagues-and-teams.json
 * @param {Object} customAliases - Custom alias mappings
 * @returns {Map<string, string>} Map from normalized name to canonical name
 * 
 * @example
 * const aliasMap = buildAliasMap(leagues, TEAM_NAME_ALIASES);
 * aliasMap.get("arsenal") // Returns: "Arsenal"
 */
export function buildAliasMap(leaguesData, customAliases = {}) {
  const map = new Map();

  const addAlias = (alias, canonical) => {
    if (!alias || !canonical) return;
    const normalized = normalizeTeamName(alias);
    if (!normalized) return;
    if (!map.has(normalized)) {
      map.set(normalized, canonical);
    }
  };

  // Add aliases from leagues data
  for (const leagueInfo of Object.values(leaguesData)) {
    for (const team of leagueInfo.teams || []) {
      if (!team?.name) continue;
      for (const variant of generateNameVariants(team.name)) {
        addAlias(variant, team.name);
      }
    }
  }

  // Add custom aliases
  for (const [canonical, aliases] of Object.entries(customAliases || {})) {
    if (canonical) {
      for (const variant of generateNameVariants(canonical)) {
        addAlias(variant, canonical);
      }
    }
    for (const alias of aliases || []) {
      for (const variant of generateNameVariants(alias)) {
        addAlias(variant, canonical);
      }
    }
  }

  return map;
}

/**
 * Builds a league name mapping for fuzzy league matching.
 * 
 * @param {Object} leaguesData - Leagues data
 * @returns {Map<string, string>} Map from normalized league name to canonical name
 */
export function buildLeagueMap(leaguesData) {
  const map = new Map();
  
  for (const leagueName of Object.keys(leaguesData)) {
    for (const variant of generateLeagueVariants(leagueName)) {
      const normalized = normalizeLeagueName(variant);
      if (normalized && !map.has(normalized)) {
        map.set(normalized, leagueName);
      }
    }
  }
  
  return map;
}

/**
 * Builds a map from team names to their leagues.
 * 
 * @param {Object} leaguesData - Leagues data
 * @returns {Map<string, string[]>} Map from team name to array of league names
 */
export function buildTeamToLeagues(leaguesData) {
  const map = new Map();
  
  for (const [leagueName, leagueInfo] of Object.entries(leaguesData)) {
    for (const team of leagueInfo.teams || []) {
      if (!team?.name) continue;
      const list = map.get(team.name) || [];
      list.push(leagueName);
      map.set(team.name, list);
    }
  }
  
  return map;
}

/**
 * Builds a map from Unibet groupId to league names.
 * Used for filtering Unibet events by league.
 * 
 * @param {Object} leaguesData - Leagues data
 * @returns {Map<string, string[]>} Map from groupId to array of league names
 */
export function buildGroupIdToLeagues(leaguesData) {
  const map = new Map();
  
  for (const [leagueName, leagueInfo] of Object.entries(leaguesData)) {
    if (
      leagueInfo.groupId !== undefined &&
      leagueInfo.groupId !== null &&
      leagueInfo.groupId !== ""
    ) {
      const key = String(leagueInfo.groupId);
      const list = map.get(key) || [];
      list.push(leagueName);
      map.set(key, list);
    }
  }
  
  return map;
}

/**
 * Resolves a team name using an alias map.
 * Tries exact match first, then fuzzy match without common prefixes.
 * 
 * @param {string} name - Team name to resolve
 * @param {Map<string, string>} aliasMap - Alias map from buildAliasMap
 * @returns {string|null} Canonical team name, or null if not found
 * 
 * @example
 * const canonical = resolveTeamName("Arsenal FC", aliasMap);
 * // Returns: "Arsenal"
 */
export function resolveTeamName(name, aliasMap) {
  const normalized = normalizeTeamName(name);
  if (!normalized) return null;
  
  // Try exact match
  if (aliasMap.has(normalized)) {
    return aliasMap.get(normalized);
  }
  
  // Try fuzzy match (remove common prefixes)
  const cleaned = normalized
    .replace(/\b(?:fc|cf|ac|afc|club|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  
  if (cleaned && aliasMap.has(cleaned)) {
    return aliasMap.get(cleaned);
  }
  
  return null;
}

/**
 * Canonicalizes a team name using alias resolution.
 * Falls back to the original name if no canonical name is found.
 * 
 * @param {string} name - Team name to canonicalize
 * @param {Map<string, string>} aliasMap - Alias map from buildAliasMap
 * @returns {string|null} Canonical team name, or original name if not found
 * 
 * @example
 * const canonical = canonicalizeTeamName("Wolves", aliasMap);
 * // Returns: "Wolverhampton"
 */
export function canonicalizeTeamName(name, aliasMap) {
  const resolved = resolveTeamName(name, aliasMap);
  if (resolved) return resolved;
  return typeof name === "string" ? name.trim() : null;
}

/**
 * Slugifies a name for URL-safe identifiers.
 * 
 * @param {string} value - Value to slugify
 * @returns {string} Slugified string
 * 
 * @example
 * slugify("Arsenal FC") // Returns: "arsenal-fc"
 * slugify("Bayern München") // Returns: "bayern-munchen"
 */
export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalizes a key by removing all non-alphanumeric characters.
 * Used in update-teams-v2.js for strict matching.
 * 
 * @param {string} value - Value to normalize
 * @returns {string|null} Normalized key, or null if invalid
 * 
 * @example
 * normalizeKey("Arsenal FC") // Returns: "arsenalfc"
 */
export function normalizeKey(value) {
  if (typeof value !== "string") return null;

  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}
