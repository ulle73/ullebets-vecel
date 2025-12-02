// FIL 3

import fs from "fs/promises";
import { exec } from "child_process";
import { spawn } from "child_process";

// 🔥 Analysera spelarens prestation baserat på matchstatistik
async function analyzePlayerPerformance(player, matchType) {
    try {
        console.log(`🌍 Analyserar prestation för ${player.name} (${matchType})...`);

        // 📂 Läs in matchstatistik
        const matchStatsFilename = `playerstats/${player.name.toLowerCase().replace(/\s/g, "_")}_${matchType}_match_stats.json`;
        const matchStats = JSON.parse(await fs.readFile(matchStatsFilename, "utf-8"));

        if (!matchStats || matchStats.length === 0) {
            console.error(`❌ Inga matchstatistik hittades för ${player.name} (${matchType})!`);
            return;
        }

        let results = [];
        // Variabler för att beräkna snitt spelade minuter
        let totalMinutes = 0;
        let minutesCount = 0;

        for (const match of matchStats) {
            const playerStats = match.statistics.statistics;
            if (!playerStats || typeof playerStats !== "object") {
                console.warn(`⚠️ Ingen statistik tillgänglig för match ${match.matchId}`);
                continue;
            }
            
            // Om fältet "minutesPlayed" finns, lägg till för snittberäkning
            if (typeof playerStats.minutesPlayed === "number") {
                totalMinutes += playerStats.minutesPlayed;
                minutesCount++;
            }
            
            console.log(`📊 Statistik för match ${match.matchId}, ${match.matchDate}:`);
            Object.entries(playerStats).forEach(([key, value]) => {
               // console.log(`   ➡️ ${key}: ${JSON.stringify(value)}`);
            });

            results.push({
                matchId: match.matchId,
                homeTeam: match.homeTeam,
                awayTeam: match.awayTeam,
                statistics: Object.entries(playerStats).map(([key, value]) => ({
                    key,
                    value
                }))
            });
        }

        // Beräkna snitt spelade minuter
        const averageMinutesPlayed = minutesCount > 0 ? totalMinutes / minutesCount : 0;
        console.log(`🕒 ${player.name} har i snitt spelat ${averageMinutesPlayed.toFixed(2)} minuter per match.`);

        // 💾 Spara analysresultat med snitt minutspelad
        const analysisFilename = `playerstats/${player.name.toLowerCase().replace(/\s/g, "_")}_${matchType}_bet_analysis.json`;
        const analysisData = {
            averageMinutesPlayed: averageMinutesPlayed,
            matches: results
        };
        await fs.writeFile(analysisFilename, JSON.stringify(analysisData, null, 4));
        console.log(`✅ Bet-analys för ${player.name} (${matchType}) sparad i '${analysisFilename}'!`);
    } catch (error) {
        console.error("❌ Ett fel inträffade:", error.message);
    }
}

// 📌 **Huvudfunktion som kör analysen för alla spelare**
async function main() {
    try {
        // 📂 Läs in spelarlistan
        const playersFilename = "playerstats/players.json";
        const playersData = JSON.parse(await fs.readFile(playersFilename, "utf-8"));

        if (!playersData || (!playersData.playersToAnalyzeHome && !playersData.playersToAnalyzeAway)) {
            console.error("❌ Inga spelare att analysera!");
            return;
        }

        // 🔥 Analysera hemmalagets spelare
        for (const playerName of playersData.playersToAnalyzeHome || []) {
            await analyzePlayerPerformance(playerName, "home");
        }

        // 🔥 Analysera bortalagets spelare
        for (const playerName of playersData.playersToAnalyzeAway || []) {
            await analyzePlayerPerformance(playerName, "away");
        }

        console.log("✅ All data har sparats. Startar nästa analys...");

        // 🚀 Starta players-4.js
        console.log("🚀 Startar players-4...");
        const process = spawn("node", ["players-4.js"], { stdio: "inherit" });

        process.on("close", (code) => {
            if (code === 0) {
                console.log("✅ players-4.js har körts klart!");
            } else {
                console.error(`❌ players-4.js avslutades med kod: ${code}`);
            }
        });

    } catch (error) {
        console.error("❌ Ett fel inträffade vid inläsning av spelare:", error.message);
    }
}

// 🚀 Starta programmet
main();
