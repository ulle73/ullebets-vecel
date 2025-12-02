import fs from "fs/promises";
import axios from "axios";
import { exec } from "child_process";
import { spawn } from "child_process";

// 📌 **Funktion för att hämta senaste matchen och startelvan**
async function fetchLatestMatchPlayers(teamName) {
    try {


        await fs.unlink("playerstats/perfect-bet.json").catch(error => {
            if (error.code === "ENOENT") {
                console.log("ℹ️ playerstats/perfect-bet.json finns inte.");
            } else {
                console.error("❌ Kunde inte radera playerstats/perfect-bet.json:", error.message);
            }
        });

        const teamsData = JSON.parse(await fs.readFile("../UNIBET/leagues-and-teams.json", "utf-8"));

        let foundTeam = null;
        for (const leagueName in teamsData) {
            const league = teamsData[leagueName];
            const team = league.teams.find(t => t.name.toLowerCase() === teamName.toLowerCase());

            if (team) {
                foundTeam = {
                    leagueId: league.leagueId,
                    seasonId: league.seasonId,
                    teamId: team.id,
                    leagueName
                };
                break;
            }
        }

        if (!foundTeam) {
            console.error(`❌ Laget '${teamName}' hittades inte i leagues-and-teams.json!`);
            return [];
        }

        console.log(`✅ Hittade laget '${teamName}' i ${foundTeam.leagueName}: LigaID ${foundTeam.leagueId}, TeamID ${foundTeam.teamId}`);

        // 🔥 Hämta senaste matcherna
        const matchesApi = `https://www.sofascore.com/api/v1/team/${foundTeam.teamId}/events/last/0`;
        const matchResponse = await axios.get(matchesApi);
        const matches = matchResponse.data?.events || [];

        if (matches.length < 3) {
            console.error(`❌ Mindre än 3 matcher hittades för ${teamName}`);
            return [];
        }

        // 🌟 Hämta de senaste 3 matcherna (sorterat i fallande ordning efter starttid)
        const latestMatches = matches.sort((a, b) => b.startTimestamp - a.startTimestamp).slice(0, 3);

        // 🗘️ Logga vilka matcher som kommer att analyseras
        console.log(`🗕️ De senaste 3 matcherna för ${teamName}:`);
        latestMatches.forEach((match, index) => {
            const matchDate = new Date(match.startTimestamp * 1000).toISOString().split("T")[0];
            console.log(`   ${index + 1}. ${match.homeTeam.name} vs ${match.awayTeam.name} (Match ID: ${match.id}), Datum: ${matchDate}`);
        });

        let allPlayers = [];

        for (const match of latestMatches) {
            const matchDate = new Date(match.startTimestamp * 1000).toISOString().split("T")[0];
            console.log(`\n📌 Hämtar lineup för match: ${match.homeTeam.name} vs ${match.awayTeam.name} (Match ID: ${match.id}), ${matchDate}`);

            // 🔥 Hämta startelvan för varje match
            const lineupApi = `https://www.sofascore.com/api/v1/event/${match.id}/lineups`;
            console.log(`🌍 Hämtar lineup från: ${lineupApi}`);

            try {
                const lineupResponse = await axios.get(lineupApi);
                const lineups = lineupResponse.data || {};

                // ✅ Hämta rätt lineup beroende på om laget var hemma eller borta
                const teamLineup = lineups.home?.players[0]?.teamId === foundTeam.teamId
                    ? lineups.home
                    : lineups.away?.players[0]?.teamId === foundTeam.teamId
                        ? lineups.away
                        : null;

                if (!teamLineup) {
                    console.error(`❌ Ingen lineup hittades för ${teamName} i matchen ${match.id}`);
                    continue;
                }

                console.log(`✅ Hittade lineup för ${teamName} (TeamID: ${foundTeam.teamId})`);

                // 🌟 Extrahera spelare och inkludera matchinformation
                const players = teamLineup.players
                    .filter(player => player.teamId === foundTeam.teamId)
                    .map(player => ({
                        id: player.player.id,
                        name: player.player.name,
                        started: !player.substitute,
                        position: player.position,
                        rating: player.statistics?.rating || null,
                        matchId: match.id,
                        matchDate: matchDate,
                        opponent: foundTeam.teamId === match.homeTeam.id ? match.awayTeam.name : match.homeTeam.name,
                        homeOrAway: foundTeam.teamId === match.homeTeam.id ? 'home' : 'away',
                        leagueId: foundTeam.leagueId,
                        seasonId: foundTeam.seasonId
                    }));

                // 📋 Logga vilka spelare som hittades för denna match
                console.log(`👥 Spelare för ${teamName} i matchen mot ${players[0]?.opponent}:`);
                players.forEach(player => {
                    console.log(`   - ${player.name} (${player.position}) | Startade: ${player.started ? "Ja" : "Nej"} | Rating: ${player.rating || "N/A"}`);
                });

                allPlayers.push(...players);
            } catch (error) {
                console.error(`❌ Fel vid hämtning av lineup för match ${match.id}: ${error.message}`);
            }
        }

        console.log(`\n📅 Totalt ${allPlayers.length} spelare hittades för ${teamName} från de senaste 3 matcherna.`);
        return allPlayers;

    } catch (error) {
        console.error(`❌ Fel vid hämtning av senaste matchens spelare för ${teamName}:`, error.message);
        return [];
    }
}

// 🔥 Hämta statistik och senaste matcher för en specifik spelare
async function fetchPlayerStats(teamName, matchType, player) {
    try {
        // Kontrollera om spelaren startade minst en gång de senaste 3 matcherna
        const teamsData = JSON.parse(await fs.readFile("playerstats/players.json", "utf-8"));
        const allPlayers = matchType === "home" ? teamsData.playersToAnalyzeHome : teamsData.playersToAnalyzeAway;

        const startedInRecentMatches = allPlayers
            .filter(p => p.id === player.id)
            .some(p => p.started);

        if (!startedInRecentMatches) {
            console.log(`⏭️ Skippar ${player.name}, startade inte i någon av de senaste 3 matcherna.`);
            return;
        }

        console.log(`✅ Inkluderar ${player.name}, startade minst en av de senaste 3 matcherna.`);

        console.log(`🌍 Hämtar statistik och senaste ${matchType}-matcher för ${player.name} i laget ${teamName}...`);

        const playersArray = matchType === "home" ? teamsData.playersToAnalyzeHome : teamsData.playersToAnalyzeAway;

        if (!playersArray || playersArray.length === 0) {
            console.error(`❌ Inga spelare att analysera för ${matchType} i playerstats/players.json!`);
            return;
        }

        const firstPlayer = playersArray[0];

        if (!firstPlayer || !firstPlayer.leagueId || !firstPlayer.seasonId) {
            console.error(`❌ Kunde inte hitta leagueId eller seasonId i playerstats/players.json för ${teamName}`);
            return;
        }

        const { leagueId, seasonId } = firstPlayer;

        console.log(`✅ Hittade ligaID ${leagueId} och säsongID ${seasonId} för ${teamName}`);

        const playerStatsApi = `https://www.sofascore.com/api/v1/player/${player.id}/unique-tournament/${leagueId}/season/${seasonId}/statistics/overall`;
        const playerMatchesApi = `https://www.sofascore.com/api/v1/player/${player.id}/unique-tournament/${leagueId}/season/${seasonId}/heatmap/overall`;

        try {
            const responseStats = await axios.get(playerStatsApi);
            const responseMatches = await axios.get(playerMatchesApi);

            let statsData = responseStats.data;
            let allMatches = responseMatches.data?.events || [];

            const filteredMatches = allMatches.filter(event => {
                const isHomeMatch = event.homeTeam?.name.toLowerCase() === teamName.toLowerCase();
                return matchType === "home" ? isHomeMatch : !isHomeMatch;
            });

            console.log(`✅ Hittade ${filteredMatches.length} relevanta ${matchType}-matcher för ${player.name}`);

            const eventUrls = filteredMatches.map(event =>
                `https://www.sofascore.com/api/v1/event/${event.id}/player/${player.id}/statistics`
            );

            const eventUrlsFilename = `playerstats/${player.name.toLowerCase().replace(/\s/g, "_")}_${matchType}_event_urls.json`;
            await fs.writeFile(eventUrlsFilename, JSON.stringify(eventUrls, null, 4));
            console.log(`✅ Dynamiska match-URL:er sparade i '${eventUrlsFilename}'!`);

            statsData.matches = filteredMatches.map(event => {
                if (event.hasOwnProperty("points")) {
                    delete event.points;
                }
                return event;
            });

            const filename = `playerstats/${player.name.toLowerCase().replace(/\s/g, "_")}_${matchType}_stats.json`;
            await fs.writeFile(filename, JSON.stringify(statsData, null, 4));
            console.log(`✅ Statistik och matcher för ${player.name} (${matchType}) sparade i '${filename}'!`);

            return { player, teamName, matchType };
        } catch (error) {
            console.error(`❌ Fel vid API-anrop för ${player.name}:`, error.response?.status, error.response?.data);
        }
    } catch (error) {
        console.error("❌ Ett fel inträffade:", error.message);
    }
}

// 📌 **Huvudfunktion som hämtar statistik och startar nästa process**
async function getSelectedTeams() {
    try {
        const selectedTeams = JSON.parse(await fs.readFile("players-selectedPlayers.json", "utf-8"));
        return { homeTeam: selectedTeams.homeTeam, awayTeam: selectedTeams.awayTeam };
    } catch (error) {
        console.error(`❌ Fel vid inläsning av valda lag: ${error.message}`);
        process.exit(1);
    }
}

async function main() {
    const { homeTeam, awayTeam } = await getSelectedTeams();

    console.log(`🔍 Hämtar startelvor för ${homeTeam} och ${awayTeam} från senaste matcher...`);

    const playersToAnalyzeHome = await fetchLatestMatchPlayers(homeTeam);
    const playersToAnalyzeAway = await fetchLatestMatchPlayers(awayTeam);

    console.log(`✅ Hittade ${playersToAnalyzeHome.length} spelare i ${homeTeam}`);
    console.log(`✅ Hittade ${playersToAnalyzeAway.length} spelare i ${awayTeam}`);

    const playersFilename = "playerstats/players.json";
    await fs.writeFile(playersFilename, JSON.stringify({ playersToAnalyzeHome, playersToAnalyzeAway }, null, 4));

    for (const player of playersToAnalyzeHome) {
        await fetchPlayerStats(homeTeam, "home", player);
    }

    for (const player of playersToAnalyzeAway) {
        await fetchPlayerStats(awayTeam, "away", player);
    }

    console.log("✅ All data har sparats. Startar nästa analys...");
    await new Promise(resolve => setTimeout(resolve, 1000));

    // // 🚀 Starta players-2.js
    console.log("🚀 Startar players-2...");
    const process = spawn("node", ["players-2.js"], { stdio: "inherit" });

    process.on("close", (code) => {
        if (code === 0) {
            console.log("✅ players-2.js har körts klart!");
        } else {
            console.error(`❌ players-2.js avslutades med kod: ${code}`);
        }
    });
}

// 🚀 Starta programmet
main();
