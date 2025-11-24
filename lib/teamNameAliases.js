const BASE_TEAM_NAME_ALIASES = {
  Wolverhampton: ["Wolves", "Wolverhampton Wanderers"],
  "Wolverhampton Wanderers": ["Wolves", "Wolverhampton"],
  "West Ham United": ["West Ham", "West Ham Utd"],
  "Brighton & Hove Albion": ["Brighton"],
  "Tottenham Hotspur": ["Tottenham", "Spurs"],
  "Atlético Mineiro": ["Atlético Mineiro-MG", "Atletico Mineiro"],
  "Atlético Mineiro-MG": ["Atlético Mineiro", "Atletico Mineiro"],
  Cruzeiro: ["Cruzeiro-MG"],
  "Vasco da Gama": ["Vasco da Gama-RJ"],
  Botafogo: ["Botafogo-RJ"],
  Barcelona: ["FC Barcelona", "Barcelona FC"],
  Santos: ["Santos-SP"],
  Fluminense: ["Fluminense-RJ"],
  Flamengo: ["Flamengo-RJ"],
  Corinthians: ["Corinthians-SP"],
  Palmeiras: ["Palmeiras-SP"],
  Mirassol: ["Mirassol-SP"],
  Ceará: ["Ceará-CE", "Ceara"],
  Bahia: ["Bahia-BA"],
  Vitória: ["Vitória-BA", "Vitoria"],
  "São Paulo": ["São Paulo-SP", "Sao Paulo"],
  Juventude: ["Juventude-RS"],
  Internacional: ["Internacional-RS"],
  "Sport Recife": ["Sport Recife-PE"],
  "Red Bull Bragantino": ["RB Bragantino-SP", "Bragantino"],
  "Nottingham Forest": ["Nottingham"],
  "Leeds United": ["Leeds"],
  "SC Freiburg": ["Freiburg"],
  "VfB Stuttgart": ["Stuttgart"],
  "1. FSV Mainz 05": ["Mainz 05", "Mainz"],
  "Hamburger SV": ["Hamburg"],
  "FC Bayern München": ["Bayern München", "Bayern Munich"],
  "Athletic Club": ["Athletic Bilbao"],
  "Deportivo Alavés": ["Alaves"],
  "Girona FC": ["Girona"],
  "Levante UD": ["Levante"],
  "SV Werder Bremen": ["Werder Bremen", "Bremen"],
  "Stade Brestois": ["Brest"],
  "Paris Saint-Germain": ["PSG", "Paris SG"],
  "RC Lens": ["Lens"],
  "RC Strasbourg": ["Strasbourg"],
  "Stade Rennais": ["Rennes"],
  "Olympique Lyonnais": ["Lyon"],
  "Olympique de Marseille": ["Marseille"],
};

const NORMALIZED_ORIGINALS = new Map();
const ALIAS_GRAPH = new Map();

function normalizeKey(value) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function registerOriginal(value) {
  const key = normalizeKey(value);
  if (!key) return "";
  const set = NORMALIZED_ORIGINALS.get(key) ?? new Set();
  set.add(String(value).trim());
  NORMALIZED_ORIGINALS.set(key, set);
  if (!ALIAS_GRAPH.has(key)) {
    ALIAS_GRAPH.set(key, new Set());
  }
  return key;
}

function connectAliases(a, b) {
  const keyA = registerOriginal(a);
  const keyB = registerOriginal(b);
  if (!keyA || !keyB) return;
  ALIAS_GRAPH.get(keyA).add(keyB);
  ALIAS_GRAPH.get(keyB).add(keyA);
}

Object.entries(BASE_TEAM_NAME_ALIASES).forEach(([name, aliases]) => {
  registerOriginal(name);
  aliases.forEach((alias) => {
    connectAliases(name, alias);
  });
});

export function getTeamAliases(team) {
  const normalized = normalizeKey(team);
  if (!normalized) {
    return team ? [String(team).trim()] : [];
  }
  const visited = new Set();
  const result = new Set();
  const queue = [normalized];

  while (queue.length) {
    const current = queue.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const originals = NORMALIZED_ORIGINALS.get(current);
    if (originals) {
      originals.forEach((value) => result.add(value));
    }
    const neighbors = ALIAS_GRAPH.get(current);
    if (neighbors) {
      neighbors.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      });
    }
  }

  if (!result.size && NORMALIZED_ORIGINALS.has(normalized)) {
    NORMALIZED_ORIGINALS.get(normalized).forEach((value) => result.add(value));
  }

  if (!result.size) {
    const trimmed = String(team).trim();
    if (trimmed) result.add(trimmed);
  }

  return Array.from(result);
}

export function areTeamNamesEquivalent(teamA, teamB) {
  const keyA = normalizeKey(teamA);
  const keyB = normalizeKey(teamB);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;

  const aliasesA = new Set(
    getTeamAliases(teamA).map((alias) => normalizeKey(alias)).filter(Boolean)
  );
  if (aliasesA.has(keyB)) {
    return true;
  }

  const aliasesB = new Set(
    getTeamAliases(teamB).map((alias) => normalizeKey(alias)).filter(Boolean)
  );
  if (aliasesB.has(keyA)) {
    return true;
  }

  return false;
}

export function normalizeTeamAlias(value) {
  return normalizeKey(value);
}

export default BASE_TEAM_NAME_ALIASES;
