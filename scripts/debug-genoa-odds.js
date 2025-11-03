import { fetchTeamMatches } from "../lib/backtest/data.js";
import { extractClosingOdds } from "../lib/utils/closingOdds.js";
import clientPromise from "../lib/mongo.js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function debugGenoaOdds() {
  console.log("=== Debugging Genoa Odds ===");

  try {
    // Fetch Genoa home matches
    console.log("\n--- Fetching Genoa Home Matches ---");
    const genoaHome = await fetchTeamMatches("Genoa", "home");
    console.log(`Genoa home matches count: ${genoaHome.length}`);
    console.log("First few Genoa home matches:");
    genoaHome.slice(0, 3).forEach((match, i) => {
      console.log(`Match ${i + 1}:`, {
        date: match.date,
        homeTeam: match.homeTeamName,
        awayTeam: match.awayTeamName,
        hasOdds: !!match.odds,
        oddsStructure: match.odds ? Object.keys(match.odds) : null,
        closingOdds: extractClosingOdds(match),
      });
    });

    // Fetch Genoa away matches
    console.log("\n--- Fetching Genoa Away Matches ---");
    const genoaAway = await fetchTeamMatches("Genoa", "away");
    console.log(`Genoa away matches count: ${genoaAway.length}`);
    console.log("First few Genoa away matches:");
    genoaAway.slice(0, 3).forEach((match, i) => {
      console.log(`Match ${i + 1}:`, {
        date: match.date,
        homeTeam: match.homeTeamName,
        awayTeam: match.awayTeamName,
        hasOdds: !!match.odds,
        oddsStructure: match.odds ? Object.keys(match.odds) : null,
        closingOdds: extractClosingOdds(match),
      });
    });

    // Compare with another team (e.g., Sassuolo)
    console.log("\n--- Comparing with Sassuolo Home Matches ---");
    const sassuoloHome = await fetchTeamMatches("Sassuolo", "home");
    console.log(`Sassuolo home matches count: ${sassuoloHome.length}`);
    console.log("First few Sassuolo home matches:");
    sassuoloHome.slice(0, 3).forEach((match, i) => {
      console.log(`Match ${i + 1}:`, {
        date: match.date,
        homeTeam: match.homeTeamName,
        awayTeam: match.awayTeamName,
        hasOdds: !!match.odds,
        oddsStructure: match.odds ? Object.keys(match.odds) : null,
        closingOdds: extractClosingOdds(match),
      });
    });

    // Check database documents directly
    console.log("\n--- Checking Database Documents ---");
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB || "app");
    const col = db.collection("teamstats");

    // Primary filter for Genoa home
    const genoaHomeFilter = {
      "_importMeta.teamName": { $regex: "^Genoa$", $options: "i" },
      "_importMeta.teamRole": "home"
    };
    const genoaHomeDoc = await col.findOne(genoaHomeFilter, { projection: { full: 1, _importMeta: 1 } });
    console.log("Genoa home document found:", !!genoaHomeDoc);
    if (genoaHomeDoc) {
      console.log("Genoa home matches with odds:", genoaHomeDoc.full.filter(m => extractClosingOdds(m)).length);
      console.log("Sample Genoa match structure:", JSON.stringify(genoaHomeDoc.full[0], null, 2).slice(0, 1000));
    }

    // Primary filter for Sassuolo home
    const sassuoloHomeFilter = {
      "_importMeta.teamName": { $regex: "^Sassuolo$", $options: "i" },
      "_importMeta.teamRole": "home"
    };
    const sassuoloHomeDoc = await col.findOne(sassuoloHomeFilter, { projection: { full: 1, _importMeta: 1 } });
    console.log("Sassuolo home document found:", !!sassuoloHomeDoc);
    if (sassuoloHomeDoc) {
      console.log("Sassuolo home matches with odds:", sassuoloHomeDoc.full.filter(m => extractClosingOdds(m)).length);
      console.log("Sample Sassuolo match structure:", JSON.stringify(sassuoloHomeDoc.full[0], null, 2).slice(0, 1000));
    }

  } catch (error) {
    console.error("Error in debug script:", error);
  }
}

debugGenoaOdds();