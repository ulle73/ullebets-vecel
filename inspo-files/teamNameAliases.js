const TEAM_NAME_ALIASES = {
  // Example aliases; add more as needed
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
  "Atlético Mineiro": ["Atlético Mineiro-MG"],
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
  Barcelona: ["FC Barcelona"],
  "SV Werder Bremen": ["Werder Bremen"],
  "Stade Brestois": ["Brest"],
  "Paris Saint-Germain": ["PSG"],
  "RC Lens": ["Lens"],
  "RC Strasbourg": ["Strasbourg"],
  "Stade Rennais": ["Rennes"],
  "Olympique Lyonnais": ["Lyon"],
  "Olympique de Marseille": ["Marseille"],
};

export function getTeamAliases(team) {
  const aliases = TEAM_NAME_ALIASES[team] || [];
  return Array.from(new Set([team, ...aliases]));
}

export default TEAM_NAME_ALIASES;
