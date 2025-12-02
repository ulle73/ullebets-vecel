// FIL 2

import fs from "fs/promises";
import axios from "axios";
import { exec } from "child_process";
import { spawn } from "child_process";

// 🔥 Hämta statistik för varje match
async function fetchMatchStatistics(player, matchType) {
    try {
        console.log(`🌍 Hämtar ${matchType}-matchstatistik för ${player.name}...`);

        // 📂 Läs in event URLs
        const eventUrlsFilename = `playerstats/${player.name.toLowerCase().replace(/\s/g, "_")}_${matchType}_event_urls.json`;
        const eventUrls = JSON.parse(await fs.readFile(eventUrlsFilename, "utf-8"));

        if (!eventUrls || eventUrls.length === 0) {
            console.error(`❌ Inga match-URL:er hittades för ${player.name} (${matchType})!`);
            return;
        }

        let matchStats = [];

        for (const eventUrl of eventUrls) {
            let eventId = null;

            try {
                // Extrahera match-ID från URL:en
                const match = eventUrl.match(/event\/(\d+)/);
                if (!match || match.length < 2) {
                    console.warn(`⚠️ Kunde inte extrahera match-ID från URL: ${eventUrl}`);
                    continue;
                }
                
                eventId = match[1];
                console.log(`🌐 Hämtar data för match-ID ${eventId}`);

                // 🔗 Hämta matchens lag
                const matchInfoApi = `https://www.sofascore.com/api/v1/event/${eventId}`;
                const matchResponse = await axios.get(matchInfoApi);
                const matchData = matchResponse.data;
                
                if (!matchData.event) {
                    console.warn(`⚠️ Ingen matchdata hittades för match-ID ${eventId}`);
                    continue;
                }

                const homeTeam = matchData.event.homeTeam?.name || "Okänd";
                const awayTeam = matchData.event.awayTeam?.name || "Okänd";
                const matchDate = new Date(matchData.event.startTimestamp * 1000).toISOString().split("T")[0];
                
                console.log(`✅ Match: ${homeTeam} vs ${awayTeam}`);

                // 🔗 Hämta spelarstatistik för denna match
                const playerStatsResponse = await axios.get(eventUrl);
                const playerStats = playerStatsResponse.data;

                console.log(`✅ Hämtade spelarstatistik för ${player.name} (${matchType}) i match ${eventId}, ${matchDate}`);

                // 📌 Lägg till i listan
                matchStats.push({
                    matchId: eventId,
                    matchDate,
                    homeTeam,
                    awayTeam,
                    statistics: playerStats,
                });

            } catch (error) {
                console.error(`❌ Fel vid hämtning av data för match-ID ${eventId || "Okänt"}:`, error.message);
            }

            // ⏳ Undvik rate-limiting
            // await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // 💾 Spara all matchstatistik
        const matchStatsFilename = `playerstats/${player.name.toLowerCase().replace(/\s/g, "_")}_${matchType}_match_stats.json`;
        await fs.writeFile(matchStatsFilename, JSON.stringify(matchStats, null, 4));
        console.log(`✅ Matchstatistik för ${player.name} (${matchType}) sparad i '${matchStatsFilename}'!`);
    } catch (error) {
        console.error("❌ Ett fel inträffade:", error.message);
    }
}

// 📌 **Huvudfunktion som hämtar statistik för alla spelare**
async function main() {
    try {
        // 📂 Läs in spelarlistan
        const playersFilename = "playerstats/players.json";
        const playersData = JSON.parse(await fs.readFile(playersFilename, "utf-8"));

        if (!playersData || (!playersData.playersToAnalyzeHome && !playersData.playersToAnalyzeAway)) {
            console.error("❌ Inga spelare att analysera!");
            return;
        }

        // 🔥 Hämta statistik för hemmalagets spelare
        for (const player of playersData.playersToAnalyzeHome || []) {
            await fetchMatchStatistics(player, "home");
        }

        // 🔥 Hämta statistik för bortalagets spelare
        for (const player of playersData.playersToAnalyzeAway || []) {
            await fetchMatchStatistics(player, "away");
        }

        console.log("✅ All data har sparats. Startar nästa analys...");
await new Promise(resolve => setTimeout(resolve, 1000)); // Säkerställ att allt sparats

 // 🚀 Starta file2-players.js
 console.log("🚀 Startar players-3...");
 const process = spawn("node", ["players-3.js"], { stdio: "inherit" });

 process.on("close", (code) => {
     if (code === 0) {
         console.log("✅ players-3.js har körts klart!");
     } else {
         console.error(`❌ players-3.js avslutades med kod: ${code}`);
     }
 });


    } catch (error) {
        console.error("❌ Ett fel inträffade vid inläsning av spelare:", error.message);
    }
}

// 🚀 Starta programmet
main(); 
