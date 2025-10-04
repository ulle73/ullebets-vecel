export const MATCH_TYPES = ["home", "away"];

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]/g;
const MULTISPACE_REGEX = /\s+/g;
const DIACRITICS_REGEX = /[\u0300-\u036f]/g;

export function sanitizeFileComponent(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .replace(INVALID_FILENAME_CHARS, "")
    .replace(MULTISPACE_REGEX, " ")
    .trim();
}

export function leagueDirectorySegment(leagueName) {
  return sanitizeFileComponent(leagueName).replace(MULTISPACE_REGEX, "-");
}

export function teamProfileFileName(teamName, matchType) {
  return `${sanitizeFileComponent(teamName)}_${matchType}.json`;
}

export function isValidMatchType(matchType) {
  return MATCH_TYPES.includes((matchType ?? "").toLowerCase());
}