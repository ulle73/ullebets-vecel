import fs from "fs/promises";
import { exec } from "child_process";
import { spawn } from "child_process";

// 🔥 Analysera spelarens prestation baserat på matchstatistik
async function analyzePlayerPerformance(
  player,
  matchType,
  bets,
  antalMatcher = "all"
) {
  try {
    // 📂 Läs in matchstatistik
    const matchStatsFilename = `playerstats/${player.name
      .toLowerCase()
      .replace(/\s/g, "_")}_${matchType}_match_stats.json`;
    let matchStats = JSON.parse(await fs.readFile(matchStatsFilename, "utf-8"));

    if (!matchStats || matchStats.length === 0) {
      console.error(
        `❌ Inga matchstatistik hittades för ${player.name} (${matchType})!`
      );
      return;
    }

    if (antalMatcher !== "all") {
      matchStats = matchStats.slice(0, antalMatcher);
    }

    // ------------------------------
    // Beräkna snitt spelade minuter
    let totalMinutes = 0;
    let minutesCount = 0;
    for (const match of matchStats) {
      const playerStats = match.statistics?.statistics;
      if (playerStats && typeof playerStats.minutesPlayed === "number") {
        totalMinutes += playerStats.minutesPlayed;
        minutesCount++;
      }
    }
    const averageMinutesPlayed = minutesCount > 0 ? totalMinutes / minutesCount : 0;
    // ------------------------------

    let betResults = [];

    function analyzeMatches(matches) {
      matches.forEach((match) => {
        const playerStats = match.statistics?.statistics || {};

        if (!playerStats || typeof playerStats !== "object") {
          console.warn(
            `⚠️ Ingen statistik tillgänglig för match ${match.matchId}`
          );
          return;
        }

        // 🔥 Beräkna totalShots som summan av onTargetScoringAttempt, shotOffTarget, och blockedScoringAttempt
        const totalShots =
          (playerStats.onTargetScoringAttempt || 0) +
          (playerStats.shotOffTarget || 0) +
          (playerStats.blockedScoringAttempt || 0);

        bets.forEach((bet) => {
          const { statKey, threshold, condition } = bet;

          // 🔍 Hämta rätt värde baserat på om det är totalShots eller en vanlig stat
          let value =
            statKey === "totalShots"
              ? totalShots
              : playerStats[statKey] !== undefined
              ? playerStats[statKey]
              : 0;

          // 🎯 Kolla om spelet träffade eller ej
          let statPassed =
            condition === "over" ? value > threshold : value < threshold;
          let existing = betResults.find(
            (r) =>
              r.statKey === statKey &&
              r.threshold === threshold &&
              r.condition === condition
          );

          if (existing) {
            existing.hitCount += statPassed ? 1 : 0;
            existing.totalMatches++;
            existing.matches.push({
              matchId: match.matchId,
              matchDate: match.matchDate,
              homeTeam: match.homeTeam,
              awayTeam: match.awayTeam,
              actualValue: value,
            });
          } else {
            betResults.push({
              statKey,
              threshold,
              condition,
              hitCount: statPassed ? 1 : 0,
              totalMatches: 1,
              teamName: matchType === "home" ? match.homeTeam : match.awayTeam, // 🆕 Lägg till laginformation
              matches: [
                {
                  matchId: match.matchId,
                  matchDate: match.matchDate,
                  homeTeam: match.homeTeam,
                  awayTeam: match.awayTeam,
                  actualValue: value,
                },
              ],
            });
          }
        });
      });
    }

    analyzeMatches(matchStats);

    // 🔍 Sortera resultat efter träffsäkerhet
    let sortedResults = betResults
      .filter((r) => r.totalMatches > 0)
      .sort(
        (a, b) => b.hitCount / b.totalMatches - a.hitCount / a.totalMatches
      );

    // 🔍 Filtrera ut perfekta bets (80% eller högre träffsäkerhet)
    let perfectBets = sortedResults
      .filter((bet) => (bet.hitCount / bet.totalMatches) * 100 >= 0)
      .map((bet) => ({
        ...bet,
        successRate: ((bet.hitCount / bet.totalMatches) * 100).toFixed(2) + "%",
        // Lägg till snittet spelade minuter för spelaren
        averageMinutesPlayed: averageMinutesPlayed.toFixed(2)
      }));

    // 💾 Spara perfekta bets i en JSON-fil grupperat per spelare
    if (perfectBets.length > 0) {
      const filePath = "playerstats/perfect-bet.json";

      // 🔹 Läs in befintliga data om filen redan existerar
      let existingData = {};
      try {
        const fileContent = await fs.readFile(filePath, "utf-8");
        existingData = JSON.parse(fileContent);
      } catch (error) {
        console.log("ℹ️ Skapar ny 'perfect-bet.json' fil.");
      }

      // 🔹 Lägg till eller uppdatera spelarens bets
      existingData[player.name] = perfectBets;

      // 💾 Spara hela objektet igen
      await fs.writeFile(filePath, JSON.stringify(existingData, null, 4));
    } else {
      console.log(`⚠️ Inga 100% träffsäkra bets att spara för ${player.name}.`);
    }

    // 📊 **Skriv ut analysresultat på samma sätt som laganalysen**
    console.log(
      "-------------------------------------------------------------------------------------------\n"
    );

    // 🔹 Skapa en snygg inramning för spelaren
    let title = ` ${player.name.toUpperCase()} (${matchType}) `;
    let border = "═".repeat(title.length);
    console.log(`╔${border}╗`);
    console.log(`║${title}║`);
    console.log(`╚${border}╝\n`);

    // 🔥 Loopa igenom endast de filtrerade "perfekta" betsen och skriv ut dem
    perfectBets.forEach(
      ({ statKey, condition, threshold, hitCount, totalMatches, successRate, averageMinutesPlayed }) => {
        let odds = successRate > 0 ? (100 / parseFloat(successRate)).toFixed(2) : "∞";
        console.log(
          `✅ ${statKey} [${condition === "over" ? "Över" : "Under"} ${threshold}] - ${hitCount} gånger träff (${successRate} av ${totalMatches} matcher), Odds: ${odds} | Snitt spelade minuter: ${averageMinutesPlayed}`
        );
      }
    );

    // 🛑 Separator mellan spelarna
    console.log(
      "\n-------------------------------------------------------------------------------------------\n"
    );

    // 💾 Spara analysresultat
    const analysisFilename = `playerstats/${player.name
      .toLowerCase()
      .replace(/\s/g, "_")}_${matchType}_bet_analysis.json`;
    await fs.writeFile(
      analysisFilename,
      JSON.stringify(sortedResults, null, 4)
    );
  } catch (error) {
    console.error("❌ Ett fel inträffade:", error.message);
  }
}

// 📌 **StatKeys med anpassade thresholds för spelare**
const playerStatKeysWithThresholds = {
  totalPass: {
    over: Array.from({ length: 70 }, (_, i) => (20.5 + i).toFixed(1)).map(
      Number
    ),
    under: Array.from({ length: 70 }, (_, i) => (20.5 + i).toFixed(1)).map(
      Number
    ),
  },

  totalTackle: {
    over: [0.5, 1.5, 2.5],
    under: [0.5, 1.5, 2.5],
  },
  fouls: {
    over: [0.5, 1.5, 2.5],
    under: [0.5, 1.5, 2.5],
  },
  totalShots: {
    over: [1.5, 2.5, 3.5],
    under: [1.5, 2.5, 3.5],
  },
  onTargetScoringAttempt: {
    // 🔥 Nu en egen stat OCH del av totalShots
    over: [0.5, 1.5, 2.5],
    under: [0.5, 1.5, 2.5],
  },
  wasFouled: {
    over: [0],
    under: [0],
  },
};

// 🛠️ **Generera dynamiska bets**
const playerBets = Object.entries(playerStatKeysWithThresholds).flatMap(
  ([statKey, { over, under }]) => [
    ...over.map((threshold) => ({ statKey, threshold, condition: "over" })),
    ...under.map((threshold) => ({ statKey, threshold, condition: "under" })),
  ]
);

// 📌 **Huvudfunktion som kör analysen för alla spelare**
async function main() {
  try {
    const playersFilename = "playerstats/players.json";
    const playersData = JSON.parse(await fs.readFile(playersFilename, "utf-8"));

    if (
      !playersData ||
      (!playersData.playersToAnalyzeHome && !playersData.playersToAnalyzeAway)
    ) {
      console.error("❌ Inga spelare att analysera!");
      return;
    }

    for (const playerName of playersData.playersToAnalyzeHome || []) {
      await analyzePlayerPerformance(playerName, "home", playerBets);
    }

    for (const playerName of playersData.playersToAnalyzeAway || []) {
      await analyzePlayerPerformance(playerName, "away", playerBets);
    }

    console.log("\n✅ Alla spelaranalyser klara!");

    // 🚀 Starta players-5.js
    console.log("🚀 Startar players-5...");
    const process = spawn("node", ["players-5.js"], { stdio: "inherit" });

    process.on("close", (code) => {
      if (code === 0) {
        console.log("✅ players-5.js har körts klart!");
      } else {
        console.error(`❌ players-5.js avslutades med kod: ${code}`);
      }
    });
  } catch (error) {
    console.error(
      "❌ Ett fel inträffade vid inläsning av spelare:",
      error.message
    );
  }
}

// 🚀 Starta programmet
main();
