import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "leagues-and-teams";
const LOG = process.env.LOG_LEAGUES !== "0";
const TAG = "[api/leagues-and-teams]";

const log = (...args) => {
  if (LOG) console.log(TAG, ...args);
};
const logError = (...args) => console.error(TAG, ...args);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extractLeaguesFromDoc(doc) {
  if (!isPlainObject(doc)) {
    return null;
  }

  if (isPlainObject(doc.data)) {
    return doc.data;
  }

  if (isPlainObject(doc.leagues)) {
    return doc.leagues;
  }

  const { _id, data, leagues, ...rest } = doc;
  const keys = Object.keys(rest);
  if (!keys.length) {
    return null;
  }

  if (Array.isArray(rest.teams) && rest.teams.length) {
    const leagueName =
      rest.name || doc.name || rest.leagueName || doc.leagueName || doc._id || "";
    if (!leagueName) {
      return null;
    }
    const { name, leagueName: legacyLeagueName, ...info } = rest;
    return {
      [leagueName]: {
        ...info,
        name: leagueName,
        leagueName: legacyLeagueName ?? leagueName,
      },
    };
  }

  const looksLikeNestedLeagues = keys.every((key) => isPlainObject(rest[key]));
  if (looksLikeNestedLeagues) {
    return rest;
  }

  return null;
}

function mergeLeagues(target, source) {
  if (!isPlainObject(source)) {
    return target;
  }
  Object.entries(source).forEach(([leagueName, leagueInfo]) => {
    if (!leagueName) {
      return;
    }
    if (isPlainObject(leagueInfo)) {
      const { _id, ...rest } = leagueInfo;
      target[leagueName] = { ...rest };
    } else {
      target[leagueName] = leagueInfo;
    }
  });
  return target;
}

export async function GET() {
  try {
    const client = await clientPromise;
    const collection = client.db(DB_NAME).collection(COLLECTION);

    const firstDoc = await collection.findOne({}, { sort: { _id: 1 } });
    let leagues = extractLeaguesFromDoc(firstDoc);

    if (!isPlainObject(leagues)) {
      log("primary document saknar ligadata, samlar alla dokument");
      const docs = await collection.find().toArray();
      const merged = {};
      docs.forEach((doc) => {
        const extracted = extractLeaguesFromDoc(doc);
        if (extracted) {
          mergeLeagues(merged, extracted);
        }
      });
      leagues = Object.keys(merged).length ? merged : null;
    }

    if (!isPlainObject(leagues)) {
      logError("kunde inte hitta ligadata i databasen");
      return NextResponse.json({ error: "Leagues not found" }, { status: 404 });
    }

    const leagueCount = Object.keys(leagues).length;
    log("lyckades hämta ligadata", { leagueCount });

    return NextResponse.json(
      { leagues },
      {
        headers: {
          "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch (error) {
    logError("serverfel", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
