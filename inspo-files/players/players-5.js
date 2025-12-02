// Fil 5

import fs from "fs/promises";
import { spawn } from "child_process";

// 🏆 Hämta perfekta bets från `perfect-bet.json`
async function getPerfectBets() {
    try {
        const perfectBets = JSON.parse(await fs.readFile("playerstats/perfect-bet.json", "utf-8"));
       
        return perfectBets;
    } catch (error) {
        console.error(`❌ Kunde inte läsa in 'perfect-bet.json': ${error.message}`);
        return {};
    }
}

// 🏆 Hämta spelarens matchstatistik från JSON-filen
async function getPlayerMatchStats(player, matchType) {
    try {
     
        const matchStatsFilename = `playerstats/${player.toLowerCase().replace(/\s/g, "_")}_${matchType}_match_stats.json`;
        const matchStats = JSON.parse(await fs.readFile(matchStatsFilename, "utf-8"));
        
        return matchStats || [];
    } catch (error) {
        console.error(`❌ Kunde inte läsa in matchstatistik för ${player} (${matchType}): ${error.message}`);
        return [];
    }
}

// 🏆 Analysfunktion som testar varje bet för en spelare
async function analyzePlayerBets(player, matchType, bets) {
    const matchStats = await getPlayerMatchStats(player, matchType);


    if (matchStats.length === 0) {
        console.log(`⚠️ Inga matcher att analysera för ${player.name} (${matchType})`);
        return;
    }

    // 🔹 Skapa en snygg inramning för spelaren
    const title = `${player.toUpperCase()} (${matchType})`;
    const border = "═".repeat(title.length);
    
    console.log(`╔═${border}═╗`);
    console.log(`║ ${title} ║`);
    console.log(`╚═${border}═╝\n`);

    // 🔥 Sortera matcherna efter datum (nyaste först) och loopa genom dem
    matchStats
        .sort((a, b) => new Date(b.matchDate) - new Date(a.matchDate))
        .forEach(match => {
            console.log(`\n| ${match.matchDate} | ⚽ ${match.homeTeam} vs ${match.awayTeam} ⚽\n`);

            let allBetsPassed = true;

            // 🔍 Hitta betsen som hör till just denna match
            const betsForMatch = bets.filter(bet => bet.matches.some(m => m.matchId === match.matchId));

            betsForMatch.forEach(bet => {
                const { statKey, threshold, condition, matches } = bet;

                // 🔍 Hämta rätt matchdata för detta bet
                const matchData = matches.find(m => m.matchId === match.matchId);
                const actualValue = matchData ? matchData.actualValue : 0;

                let statPassed = condition === "over" ? actualValue > threshold : actualValue < threshold;
                let statIcon = statPassed ? "✅" : "❌";

                console.log(`   ${statIcon} ${statKey} (${condition} ${threshold}) | Faktiskt värde: ${actualValue}`);

                if (!statPassed) allBetsPassed = false;
            });

            if (allBetsPassed) {
                console.log("\n🎯 **ALLA BETS TRÄFFADE FÖR DENNA MATCH!** 🎯");
            }
        });

    console.log(`\n══════════════════════════════════════════════════════════\n`);
}

// 🏆 **Huvudfunktion som analyserar alla spelare**
async function main() {
    try {
        const playersFilename = "playerstats/players.json";
        const playersData = JSON.parse(await fs.readFile(playersFilename, "utf-8"));

        if (!playersData || (!playersData.playersToAnalyzeHome && !playersData.playersToAnalyzeAway)) {
            console.error("❌ Inga spelare att analysera!");
            return;
        }

        const perfectBets = await getPerfectBets();

        if (Object.keys(perfectBets).length === 0) {
            console.log("⚠️ Inga 100% träffsäkra bets att analysera.");
            return;
        }

        // 🔥 Analysera hemmalagets spelare
        for (const player of playersData.playersToAnalyzeHome || []) {
            if (perfectBets[player.name]) {
                await analyzePlayerBets(player.name, "home", perfectBets[player.name]);
            }
        }

        // 🔥 Analysera bortalagets spelare
        for (const player of playersData.playersToAnalyzeAway || []) {
            if (perfectBets[player.name]) {
                await analyzePlayerBets(player.name, "away", perfectBets[player.name]);
            }
        }

            // 🚀 Starta file2-players.js
    console.log("🚀 Startar players-6...");
    const process = spawn("node", ["players-6.js"], { stdio: "inherit" });

    process.on("close", (code) => {
        if (code === 0) {
            console.log("✅ players-6.js har körts klart!");
        } else {
            console.error(`❌ players-6.js avslutades med kod: ${code}`);
        }
    });

        
    } catch (error) {
        console.error("❌ Ett fel inträffade vid inläsning av spelare:", error.message);
    }
}

// 🚀 Starta programmet
main();
