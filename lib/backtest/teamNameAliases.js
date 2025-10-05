const TEAM_NAME_ALIASES = {
  Wolverhampton: ["Wolves", "Wolverhampton Wanderers"],
  "West Ham United": ["West Ham", "West Ham Utd"],
  "Brighton & Hove Albion": ["Brighton"],
  "Tottenham Hotspur": ["Tottenham"],
  "Atlético Mineiro": ["Atlético Mineiro-MG"],
  Cruzeiro: ["Cruzeiro-MG"],
  "Vasco da Gama": ["Vasco da Gama-RJ"],
  Botafogo: ["Botafogo-RJ"],
  Barcelona: ["FC Barcelona"],
  Santos: ["Santos-SP"],
  Fluminense: ["Fluminense-RJ"],
  Flamengo: ["Flamengo-RJ"],
  Corinthians: ["Corinthians-SP"],
  Palmeiras: ["Palmeiras-SP"],
  Mirassol: ["Mirassol-SP"],
  Bahia: ["Bahia-BA"],
  Vitória: ["Vitória-BA"],
  "São Paulo": ["São Paulo-SP"],
  Juventude: ["Juventude-RS"],
  Internacional: ["Internacional-RS"],
  "Sport Recife": ["Sport Recife-PE"],
  "Red Bull Bragantino": ["RB Bragantino-SP"],
  "Nottingham Forest": ["Nottingham"],
  "Leeds United": ["Leeds"],
  "SC Freiburg": ["Freiburg"],
  "VfB Stuttgart": ["Stuttgart"],
  "1. FSV Mainz 05": ["Mainz 05"],
  "Hamburger SV": ["Hamburg"],
  "FC Bayern München": ["Bayern München"],
  "Athletic Club": ["Athletic Bilbao"],
  "Deportivo Alavés": ["Alaves"],
  "Girona FC": ["Girona"],
  "Levante UD": ["Levante"],
  "SV Werder Bremen": ["Werder Bremen"],
  "Stade Brestois": ["Brest"],
  "Paris Saint-Germain": ["PSG"],
  "RC Lens": ["Lens"],
  "RC Strasbourg": ["Strasbourg"],
  "Stade Rennais": ["Rennes"],
  "Olympique Lyonnais": ["Lyon"],
  "Olympique de Marseille": ["Marseille"],
};

function normalizeAlias(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function buildAliasSet(teamName) {
  const set = new Set();
  if (!teamName) {
    return set;
  }
  const aliases = TEAM_NAME_ALIASES[teamName] || [];
  const values = [teamName, ...aliases];
  for (const value of values) {
    const normalized = normalizeAlias(value);
    if (normalized) {
      set.add(normalized);
      const withoutSuffix = normalized.replace(/[-\s](fc|cf|afc|bk|ik|fk|if|sc)$/i, "");
      if (withoutSuffix && withoutSuffix !== normalized) {
        set.add(withoutSuffix.toLowerCase());
      }
    }
  }
  return set;
}

export function getTeamAliases(teamName) {
  const aliases = TEAM_NAME_ALIASES[teamName] || [];
  return Array.from(new Set([teamName, ...aliases].filter(Boolean)));
}

export function getComparableTeamAliases(teamName) {
  return Array.from(buildAliasSet(teamName));
}

export function createTeamAliasMatcher(teamName) {
  const aliasSet = buildAliasSet(teamName);
  if (!aliasSet.size) {
    const fallback = normalizeAlias(teamName);
    if (!fallback) {
      return () => false;
    }
    aliasSet.add(fallback);
  }
  return (candidate) => aliasSet.has(normalizeAlias(candidate));
}

export function teamsMatch(teamA, teamB) {
  const setA = buildAliasSet(teamA);
  const setB = buildAliasSet(teamB);
  const normalizedA = normalizeAlias(teamA);
  const normalizedB = normalizeAlias(teamB);
  if (normalizedA) {
    setA.add(normalizedA);
  }
  if (normalizedB) {
    setB.add(normalizedB);
  }
  if (!setA.size || !setB.size) {
    return normalizedA && normalizedB ? normalizedA === normalizedB : false;
  }
  for (const alias of setA) {
    if (setB.has(alias)) {
      return true;
    }
  }
  return false;
}

export default TEAM_NAME_ALIASES;
