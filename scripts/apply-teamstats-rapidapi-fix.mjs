import fs from "fs";

const filePath = "scripts/update-teams-v2.js";
let source = fs.readFileSync(filePath, "utf8");

const replaceOnce = (needle, replacement, label) => {
  const count = source.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 match, got ${count}`);
  }
  source = source.replace(needle, replacement);
};

const insertAfterOnce = (needle, insertion, label) => {
  const count = source.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 insertion point, got ${count}`);
  }
  source = source.replace(needle, `${needle}${insertion}`);
};

insertAfterOnce(
`const normalizeEvent = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const id = entry.id ?? entry.matchId ?? entry.eventId;
  if (!id) return null;

  const startTimestamp =
    entry.startTimestamp ??
    entry.timestamp ??
    entry.start_time ??
    entry.startTime ??
    null;

  const homeTeam =
    entry.homeTeam ?? entry.home ?? entry.home_team ?? entry.teamHome ?? {};
  const awayTeam =
    entry.awayTeam ?? entry.away ?? entry.away_team ?? entry.teamAway ?? {};

  const resolveTeamName = (team) => {
    if (typeof team === "string") return team;
    if (!team || typeof team !== "object") return null;
    return team.name ?? team.shortName ?? team.slug ?? null;
  };

  const resolveTeamId = (team) => {
    if (!team || typeof team !== "object") return null;
    return team.id ?? team.teamId ?? null;
  };

  return {
    id,
    startTimestamp,
    homeTeamName: resolveTeamName(homeTeam),
    awayTeamName: resolveTeamName(awayTeam),
    homeTeamId: resolveTeamId(homeTeam),
    awayTeamId: resolveTeamId(awayTeam),
  };
};
`,
`
const buildEventInfoFromNormalized = (normalizedEvent) => {
  if (!normalizedEvent || typeof normalizedEvent !== "object") {
    return null;
  }

  const homeTeam = {
    id: normalizedEvent.homeTeamId ?? null,
    name: normalizedEvent.homeTeamName ?? null,
  };
  const awayTeam = {
    id: normalizedEvent.awayTeamId ?? null,
    name: normalizedEvent.awayTeamName ?? null,
  };

  if (!homeTeam.name || !awayTeam.name) {
    return null;
  }

  return { homeTeam, awayTeam };
};
`,
  "insert normalized event fallback helper"
);

replaceOnce(
`async function fetchMatchDataSofascore(page, matchId, context, plan = {}) {`,
`async function fetchMatchDataSofascore(page, matchId, context, plan = {}, options = {}) {`,
  "extend fetchMatchDataSofascore signature"
);

replaceOnce(
`  const wantMatches = plan.matches ?? WANT_MATCHES;
  const wantIncidents = plan.incidents ?? WANT_INCIDENTS;
  const wantShotmap = plan.shotmap ?? WANT_SHOTMAP;
`,
`  const wantMatches = plan.matches ?? WANT_MATCHES;
  const wantIncidents = plan.incidents ?? WANT_INCIDENTS;
  const wantShotmap = plan.shotmap ?? WANT_SHOTMAP;
  const skipPublicEventInfo = Boolean(options.skipPublicEventInfo);
`,
  "add skipPublicEventInfo option"
);

replaceOnce(
`  if (wantMatches) {
    info = await browserFetch(page, \`event/\${matchId}\`);
    apiCalls++;

    if (context) {`,
`  if (wantMatches) {
    if (!skipPublicEventInfo) {
      info = await browserFetch(page, \`event/\${matchId}\`);
      apiCalls++;
    }

    if (context) {`,
  "skip public event info when requested"
);

replaceOnce(
`  if (wantMatches && !(info && stats)) {
    return null;
  }`,
`  if (wantMatches && !stats) {
    return null;
  }`,
  "only require stats from match data fetch"
);

replaceOnce(
`          const fetched =
            plan.matches || plan.incidents || plan.shotmap
              ? await fetchMatchDataSofascore(page, matchId, context, plan)
              : null;
          if (plan.matches && !(fetched?.info && fetched?.stats)) {`,
`          const fetched =
            plan.matches || plan.incidents || plan.shotmap
              ? await fetchMatchDataSofascore(page, matchId, context, plan, {
                  skipPublicEventInfo: true,
                })
              : null;
          if (plan.matches && !fetched?.stats) {`,
  "use rapidapi-only match data in yesterday mode"
);

replaceOnce(
`          const eventInfo = fetched?.info;
          const home = eventInfo?.homeTeam;
          const away = eventInfo?.awayTeam;
`,
`          const eventInfo = fetched?.info || buildEventInfoFromNormalized(normalizedEvent);
          const home = eventInfo?.homeTeam;
          const away = eventInfo?.awayTeam;
`,
  "fallback event info from scheduled match"
);

replaceOnce(
`          const { homeScore: resolvedHomeScore, awayScore: resolvedAwayScore } =
            resolveFinalScores({ primary: fetched?.info, secondary: rawEvent });`,
`          const { homeScore: resolvedHomeScore, awayScore: resolvedAwayScore } =
            resolveFinalScores({ primary: eventInfo, secondary: rawEvent });`,
  "use fallback event info for score resolution"
);

fs.writeFileSync(filePath, source, "utf8");
console.log(`Patched ${filePath}`);
