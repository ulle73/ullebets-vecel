export const teamLogoCandidates = (teamId) => {
  const base = String(teamId ?? "").trim();
  if (!base) return ["/images/teams/placeholder.png"];
  return [
    `/images/teams/${base}.png`,
    `/images/teams/${base}.webp`,
    `/images/teams/${base}.svg`,
    `/images/teams/${base}@2x.png`,
    "/images/teams/placeholder.png",
  ];
};

export const teamLogo = (teamId) => teamLogoCandidates(teamId)[0];
export const leagueLogo = (slugOrFile) => `/images/league/${slugOrFile}`;
