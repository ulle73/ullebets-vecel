// scripts/fill-team-ids.js
import clientPromise from "../lib/mongo.js";

async function main() {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");

  const leaguesCol = db.collection("leages-and-teams");
  const betsCol = db.collection("ai-generated-bets");

  // Bygg lookup: { leagueNameLower: Map(normalizedName -> id) }
  const leaguesDocs = await leaguesCol.find({}).toArray();
  const leagueLookup = new Map();

  const normalize = (name) =>
    (name || "").toString().toLowerCase().replace(/\s+/g, " ").trim();

  for (const doc of leaguesDocs) {
    for (const [leagueName, leagueObj] of Object.entries(doc)) {
      if (leagueName === "_id") continue;
      const teams = leagueObj?.teams || [];
      const map = new Map();
      teams.forEach((t) => {
        if (t?.name && t?.id != null) {
          map.set(normalize(t.name), t.id);
        }
      });
      leagueLookup.set(normalize(leagueName), map);
    }
  }

  const cursor = betsCol.find({});
  let updated = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const leagueName = normalize(doc.league || doc.metadata?.league || "");
    const teamMap = leagueLookup.get(leagueName);
    if (!teamMap) continue;

    const homeName = normalize(doc.homeTeam || doc.lines?.[0]?.homeTeam);
    const awayName = normalize(doc.awayTeam || doc.lines?.[0]?.awayTeam);

    const homeId =
      teamMap.get(homeName) ??
      doc.homeTeamId ??
      doc.lines?.[0]?.homeTeamId ??
      null;
    const awayId =
      teamMap.get(awayName) ??
      doc.awayTeamId ??
      doc.lines?.[0]?.awayTeamId ??
      null;

    const lines = (doc.lines || []).map((line) => ({
      ...line,
      homeTeamId: line.homeTeamId ?? homeId,
      awayTeamId: line.awayTeamId ?? awayId,
      teams: {
        ...line.teams,
        home: line.teams?.home ?? line.homeTeam ?? doc.homeTeam,
        away: line.teams?.away ?? line.awayTeam ?? doc.awayTeam,
        homeId: line.teams?.homeId ?? homeId,
        awayId: line.teams?.awayId ?? awayId,
      },
    }));

    await betsCol.updateOne(
      { _id: doc._id },
      {
        $set: {
          homeTeamId: homeId,
          awayTeamId: awayId,
          lines,
        },
      }
    );
    updated++;
  }

  console.log(`Updated ${updated} documents with team IDs`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
