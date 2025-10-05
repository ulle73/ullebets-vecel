import axios from "axios";
import fs from "fs/promises"; // Använder fs/promises för async hantering
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🏆 Funktion för att hämta och spara odds i JSON-format
export async function fetchUnibetOdds(matchId) {
    try {
      const url = `https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event/${matchId}.json?lang=sv_SE&market=SE&client_id=2&channel_id=1&includeParticipants=true`;
      const response = await axios.get(url);
      const data = response.data;
      console.log("unibet matchid:", matchId);

      if (!data.betOffers || !data.events || data.events.length === 0) {
        console.log("⚠️ Ingen betOffers- eller eventdata hittades.");
        return;
      }

      const eventInfo = {
        homeTeam: data.events[0]?.homeName || "",
        awayTeam: data.events[0]?.awayName || "",
        eventDate: data.events[0]?.start || "",
      };

      const jsonFile = { meta: eventInfo, odds: {} };
      data.betOffers.forEach((betOffer) => {
        const label = betOffer.criterion.label;
        if (!jsonFile.odds[label]) {
          jsonFile.odds[label] = { outcomes: [] };
        }
        betOffer.outcomes.forEach((outcome) => {
          const playerName = outcome.participant || "N/A";
          const formattedLine = outcome.line
            ? (outcome.line / 1000).toFixed(3)
            : "x";
          const decimalOdds = outcome.oddsFractional
            ? (
                parseFloat(outcome.oddsFractional.split("/")[0]) /
                  parseFloat(outcome.oddsFractional.split("/")[1]) +
                1
              ).toFixed(2)
            : "N/A";

          jsonFile.odds[label].outcomes.push({
            participant: playerName,
            label: outcome.englishLabel,
            line: formattedLine,
            odds: decimalOdds,
          });
        });
      });

      const localPath = path.join(__dirname, "unibetOdds.json");
      const tmpPath = path.join("/tmp", "unibetOdds.json");
      const filePath = existsSync(tmpPath) ? tmpPath : localPath;

      await fs.writeFile(filePath, JSON.stringify(jsonFile, null, 2), "utf8");

      console.log(`✅ Unibet-odds sparade i: ${filePath}`);
    } catch (err) {
        console.error("❌ Ett fel uppstod:", err.message);
    }
}




const oddsFilePath = path.join(process.cwd(), "unibetPredictOdds.json");



export async function fetchUnibetOddsPredictions(matchId) {
    try {
      console.log(`🚀 Hämtar odds för matchId: ${matchId}`);

      const url = `https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event/${matchId}.json?lang=sv_SE&market=SE&client_id=2&channel_id=1&includeParticipants=true`;
      const response = await axios.get(url);
      const data = response.data;

      if (!data.betOffers || !data.events || data.events.length === 0) {
        console.log(
          `⚠️ Ingen betOffers- eller eventdata hittades för matchId ${matchId}`
        );
        return;
      }

      // 🔹 Hämta automatiskt matchnamn från Unibet API
      const homeTeam = data.events[0]?.homeName || "Unknown Home Team";
      const awayTeam = data.events[0]?.awayName || "Unknown Away Team";
      const matchName = `${homeTeam} vs ${awayTeam}`;

      console.log(`📌 Matchnamn identifierat: ${matchName}`);

      // 🔹 Läs in den befintliga oddsfilen
      let existingOdds = {};
      try {
        const fileData = await fs.readFile(oddsFilePath, "utf8");
        existingOdds = JSON.parse(fileData);
        console.log("📂 Befintliga odds inlästa.");
      } catch (error) {
        if (error.code === "ENOENT") {
          console.log("🆕 Ingen befintlig oddsfil hittades. Skapar ny...");
          existingOdds = {};
        } else {
          console.error("❌ Fel vid inläsning av oddsfilen:", error.message);
          throw new Error("Kunde inte läsa oddsfilen.");
        }
      }

      // 🔹 Skapa objekt för den aktuella matchen och säkerställ att matchnamnet sparas
      let matchOdds = existingOdds[matchId] || { match: matchName, odds: {} };

      // 🔹 Loopar igenom alla odds-marknader
      data.betOffers.forEach((betOffer) => {
        const label = betOffer.criterion.label;
        if (!matchOdds.odds[label]) {
          matchOdds.odds[label] = { outcomes: [] };
        }
        betOffer.outcomes.forEach((outcome) => {
          let playerName = outcome.participant || "N/A";
          let formattedLine = outcome.line
            ? (outcome.line / 1000).toFixed(3)
            : "x";
          let decimalOdds = outcome.oddsFractional
            ? (
                parseFloat(outcome.oddsFractional.split("/")[0]) /
                  parseFloat(outcome.oddsFractional.split("/")[1]) +
                1
              ).toFixed(2)
            : "N/A";

          matchOdds.odds[label].outcomes.push({
            participant: playerName,
            label: outcome.englishLabel,
            line: formattedLine,
            odds: decimalOdds,
          });
        });
      });

      // 🔹 Uppdatera oddsen för den aktuella matchen i filen
      existingOdds[matchId] = matchOdds;

      // 🔹 Spara uppdaterad fil
      await fs.writeFile(
        oddsFilePath,
        JSON.stringify(existingOdds, null, 2),
        "utf8"
      );

      console.log(
        `✅ Unibet-odds sparade i: ${oddsFilePath} för ${matchName} (${matchId})`
      );

      // 📁 Spara även till /tmp om det finns
      const tmpOddsPath = path.join("/tmp", "unibetPredictOdds.json");
      try {
        await fs.writeFile(
          tmpOddsPath,
          JSON.stringify(existingOdds, null, 2),
          "utf8"
        );
        console.log(`✅ Unibet-odds sparade även i: ${tmpOddsPath}`);
      } catch (err) {
        console.warn(`⚠️ Kunde inte spara till /tmp: ${err.message}`);
      }
      
    } catch (err) {
        console.error(`❌ Ett fel uppstod vid hämtning av odds för ${matchId}:`, err.message);
    }
}


// 📄 Funktion för att spara oddsdata som en snygg textfil
export async function writeTextFile() {
    try {
        const url = "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event/1022375693.json?lang=sv_SE&market=SE&client_id=2&channel_id=1&ncid=1738758081465&includeParticipants=true";
        const response = await axios.get(url);
        const data = response.data;

        if (!data.betOffers || !data.events || data.events.length === 0) {
            console.log("⚠️ Ingen betOffers- eller eventdata hittades.");
            return;
        }

        // 🏆 Hämta event-information för att skapa filnamn
        const event = data.events[0];
        const name = event.name.replace(/[:/\\?<>|]/g, ""); 
        const date = event.start.split("T")[0]; 
        const league = event.group.replace(/[:/\\?<>|]/g, ""); 
        const eventId = event.id;

        // 📁 Skapa filnamn
        const fileName = `${name} - ${date} - ${league} - ${eventId}.txt`;
        const filePath = path.join(".", fileName); 

        let summaryArray = [];

        data.betOffers.forEach(betOffer => {
            const label = betOffer.criterion.label;
            let outcomesText = [];

            betOffer.outcomes.forEach(outcome => {
                let playerName = outcome.participant || "";
                let decimalOdds = "N/A";

                if (outcome.oddsFractional) {
                    const parts = outcome.oddsFractional.split("/");
                    if (parts.length === 2) {
                        const numerator = parseFloat(parts[0]);
                        const denominator = parseFloat(parts[1]);
                        decimalOdds = ((numerator / denominator) + 1).toFixed(2);
                    }
                }

                let isPlayerBet = !!outcome.participant;
                let formattedLine = outcome.line ? (outcome.line / 1000).toFixed(3) : "x"; 

                let outcomeText = `${outcome.englishLabel} (${formattedLine}) (${decimalOdds})`;

                if (isPlayerBet) {
                    outcomeText = `${playerName} - ${outcome.englishLabel} (${formattedLine}) (${decimalOdds})`;
                }

                outcomesText.push(outcomeText);
            });

            outcomesText.sort();
            summaryArray.push(`${label}: ${outcomesText.join(", ")}`);
        });

        summaryArray.sort();
        const outputText = summaryArray.join("\n");

        // 💾 Skriv till textfil asynkront
        await fs.writeFile(filePath, outputText, "utf8");

        console.log(`✅ **Oddsdata sparad i textfil: ${fileName}**`);

    } catch (err) {
        console.error("❌ Ett fel uppstod:", err.message);
    }
}

// 🏁 Kör båda funktionerna
fetchUnibetOdds();
// writeTextFile();


async function logUnibetKeys() {
    try {
        const unibetOddsFile = "unibetOdds.json";
        const unibetData = JSON.parse(await fs.readFile(unibetOddsFile, "utf-8"));

        console.log("📊 Alla nycklar i Unibet-odds:");
        Object.keys(unibetData).forEach(key => {
            console.log(`🔹 ${key}`);
        });

    } catch (error) {
        console.error("❌ Ett fel uppstod vid läsning av Unibet-odds:", error.message);
    }
}

//logUnibetKeys();