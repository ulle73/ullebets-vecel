import axios from 'axios';
import fs from 'fs';



// 🔑 Lista över API-nycklar
const apiKeys = [
  "2421949038msh47b6bd3f6b5c077p151577jsn42ebd0d9888a",
  "d26361d6a1msh55def5349c5e57dp1eaee1jsn74e247833a6e",
  "c347347d96msh753a5e5acbca775p174d61jsn4ddb08841042",
  "bcc2fe6d26msh84d34b156ba870fp1269cejsn3c65899c262e",
  "adb090d6e6msh09b5af9b62cab53p18ec97jsnf66f393501ab",
  "9ccda5724cmsh62c63c5c9b7bbb4p1a2637jsnfbfacc616c38",
  "d71b975b3bmsh119f2182f5f36a2p132437jsnc623beefd032",
  "458c4dc749msh93ad163f4a8f4efp13ac33jsn776bb3a83b55",
  "87b25a4718msh550e88b539cccfep180203jsna7971b255886",
];

let currentKeyIndex = 0;

// 🔄 Funktion för att hämta nästa API-nyckel
function getNextApiKey() {
  const key = apiKeys[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length; // Cirkulär rotation
  return key;
}


// 🔄 Standardvärde för live
let live = true;

// 🔄 Läs in matchId från players-selectedPlayers.json
let matchId = null;
try {
  const playerData = JSON.parse(fs.readFileSync('players-selectedPlayers.json', 'utf-8'));
  matchId = playerData.matchId;

  // 🔄 Kontrollera om matchId finns och används
  if (matchId) {
    console.log("⚠️ MatchId har använts tidigare. Använder sparad data.");
  } else {
    console.log("✅ Nytt matchId identifierat. Hämtar live-data.");
    live = true;
  }

} catch (error) {
  console.error("❌ Fel vid inläsning av players-selectedPlayers.json:", error.message);
  console.log("✅ Ingen tidigare data hittades. Hämtar live-data.");
  live = true;
}

// 🔄 API-anrop med det inlästa matchId
const options = {
  method: 'GET',
  url: 'https://betsapi2.p.rapidapi.com/v3/bet365/prematch',
  
  // 🔄 Här sätts matchId dynamiskt
  params: { FI: matchId },

  headers: {
    'x-rapidapi-key': getNextApiKey(),
    'x-rapidapi-host': 'betsapi2.p.rapidapi.com'
  }
};

// 🏆 Mapping mellan statistik och kategori i Bet365
const categoryMap = {
    "totalShots": ["Player Shots", "Player Shots Over/Under"],
    "onTargetScoringAttempt": ["Player Shots On Target", "Player Shots On Target Over/Under"],
    "totalPass": ["Player Passes"],
    "totalTackle": ["Player Tackles Over/Under"],
    "yellowCards": ["Player Cards"],
    "fouls": ["Player Fouls Committed", "Player Fouls Over/Under"]
  };
  

async function fetchLiveData() {
  try {
    const response = await axios.request(options);
   // console.log("✅ Hämtade data från API:t");

    fs.writeFileSync('bet365Odds.json', JSON.stringify(response.data, null, 2));
   // console.log('✅ Data har sparats i bet365Odds.json');

    return response.data;
  } catch (error) {
    console.error("❌ Fel vid hämtning från API:", error);
    return null;
  }
}

function fetchOfflineData() {
  try {
    if (!fs.existsSync('bet365Odds.json')) {
      throw new Error("Filen bet365Odds.json existerar inte. Byt till 'live' mode för att hämta data först.");
    }
    const data = JSON.parse(fs.readFileSync('bet365Odds.json', 'utf-8'));
   // console.log("✅ Laddade data från bet365Odds.json");
    return data;
  } catch (error) {
   // console.error("❌ Fel vid inläsning av JSON-filen:", error);
    return null;
  }
}

function fetchPerfectBets() {
  try {
    if (!fs.existsSync('../UNIBET/playerstats/perfect-bet.json')) {
      throw new Error("Filen perfect-bet.json existerar inte.");
    }
    const perfectBetsData = JSON.parse(fs.readFileSync('../UNIBET/playerstats/perfect-bet.json', 'utf-8'));
    const perfectBetsArray = Object.entries(perfectBetsData).flatMap(([player, bets]) =>
      bets.map(bet => ({ player, ...bet }))
    );
   // console.log("✅ Perfect-bet.json konverterat till array.");
    return perfectBetsArray;
  } catch (error) {
    console.error("❌ Fel vid inläsning av perfect-bet.json:", error);
    return [];
  }
}

function extractAndSortOdds(oddsData) {
  let structuredOdds = [];

  Object.entries(oddsData).forEach(([categoryKey, categoryData]) => {
    if (categoryData.odds.length > 0) {
      categoryData.odds.forEach(odd => {
        structuredOdds.push({
          player: odd.name,
          category: categoryData.name,
          odds: parseFloat(odd.odds) || parseInt(odd.odds),
          handicap: odd.handicap ? parseFloat(odd.handicap) : null,
          name2: odd.name2,
          header: odd.header,
          id: odd.id
        });
      });
    }
  });

  structuredOdds.sort((a, b) => a.odds - b.odds);
  return structuredOdds;
}

function matchBetsWithOdds(perfectBets, oddsData) {
    let matchedBets = [];

    perfectBets.forEach(bet => {
        let betCategory = categoryMap[bet.statKey] || bet.statKey;

        let matchingOdd = oddsData.find(odd => {
            if (!odd.player || !odd.category) return false; // Skydda mot nullvärden
        
            let playerMatch = odd.player.toLowerCase().includes(bet.player.toLowerCase());
        
            // 🔄 Hämta rätt kategori (kan vara en array av möjliga matchningar)
            let betCategoryList = categoryMap[bet.statKey] || [bet.statKey];
        
            // 🛠️ Kontrollera om odd.category finns i listan över möjliga kategorier
            let categoryMatch = betCategoryList.includes(odd.category);
        
            // 🔍 Ny logik för att hantera "Under" i handicap
            let isUnderHandicap = (odd.handicap && typeof odd.handicap === "string" && odd.handicap.startsWith("Under")) ||
            (odd.header && typeof odd.header === "string" && odd.header.toLowerCase() === "under"); // 🆕 Kollar även om header är "Under"

// 🔍 Kontrollera om bet.threshold matchar handicap ELLER header
let thresholdMatch =
(odd.handicap !== null && parseFloat(odd.handicap) === bet.threshold) ||
(odd.header !== null && parseFloat(odd.header) === bet.threshold);

// 🔍 Rätt condition måste också matcha (fixad logik)
let conditionMatch = (isUnderHandicap && bet.condition === "under") || (!isUnderHandicap && bet.condition === "over");

        
            return playerMatch && categoryMatch && thresholdMatch && conditionMatch;
        });
        

        if (matchingOdd) {
            let successRate = parseFloat(bet.successRate.replace("%", "")) / 100;
            let expectedValue = (matchingOdd.odds * successRate).toFixed(2);

            matchedBets.push({
                player: bet.player,
                teamName: bet.teamName,
                statKey: bet.statKey,
                category: matchingOdd.category,
                threshold: bet.threshold,
                condition: bet.condition,
                successRate: bet.successRate,
                hitCount: bet.hitCount,
                totalMatches: bet.totalMatches,
                odds: matchingOdd.odds,
                expectedValue,
                bet365Data: matchingOdd,
                minutesPerGame: bet.averageMinutesPlayed
            });
        }
    });

    return matchedBets;
}


// 🆕 Lägg till denna funktion för att läsa in concededFouls_data.json
function fetchConcededFoulsOdds() {
  try {
    if (!fs.existsSync('concededFouls_data.json')) {
      throw new Error("Filen concededFouls_data.json existerar inte.");
    }
    const foulsOddsData = JSON.parse(fs.readFileSync('concededFouls_data.json', 'utf-8'));
    console.log("✅ Laddade odds från concededFouls_data.json");
    return foulsOddsData;
  } catch (error) {
    console.error("❌ Fel vid inläsning av concededFouls_data.json:", error);
    return [];
  }
}

// 🆕 Lägg till denna funktion för att matcha wasFouled bets med odds
function matchWasFouledBets(perfectBets, foulsOdds) {
  const wasFouledBets = perfectBets.filter(bet => bet.statKey === "wasFouled");

  const matchedFouledBets = wasFouledBets.map(bet => {
    const matchingOdd = foulsOdds.find(odd =>
      odd.player.toLowerCase() === bet.player.toLowerCase() &&
      odd.statKey === bet.statKey &&
      odd.condition === bet.condition &&
      odd.threshold === bet.threshold
    );

    if (matchingOdd) {
      const successRate = bet.hitCount / bet.totalMatches;
      const expectedValue = (parseFloat(matchingOdd.odds) * successRate).toFixed(2);

      return {
        player: bet.player,
        statKey: bet.statKey,
        threshold: bet.threshold,
        condition: bet.condition,
        hitCount: bet.hitCount,
        totalMatches: bet.totalMatches,
        successRate: (successRate * 100).toFixed(2) + "%",
        odds: matchingOdd.odds,
        expectedValue
      };
    }
    return null;
  }).filter(bet => bet !== null);

  return matchedFouledBets;
}

// 🚀 Lägg till denna kod i din async funktion för att köra matchning och logga resultaten
// 🚀 Lägg till denna kod i din async funktion för att köra matchning och logga resultaten
(async () => {
  let data;
  if (live) {
    data = await fetchLiveData();
  } else {
    data = fetchOfflineData();
  }

  if (!data || !data.results || !data.results[0] || !data.results[0].player.sp) {
    //console.error("⚠️ Ingen giltig data tillgänglig.");
    return;
  }

  const perfectBets = fetchPerfectBets();

  const foulsData = (data.results[0].others || []).find(item => item.sp && item.sp.player_fouls_committed);

  const combinedOddsData = {
    ...data.results[0].player.sp,
    ...(foulsData ? { player_fouls_committed: foulsData.sp.player_fouls_committed } : {})
  };

  const sortedOdds = extractAndSortOdds(combinedOddsData);

  const matchedBets = matchBetsWithOdds(perfectBets, sortedOdds);
  const foulsOdds = fetchConcededFoulsOdds();
  const matchedFouledBets = matchWasFouledBets(perfectBets, foulsOdds);

  // 🆕 Kombinera matchedBets och matchedFouledBets
  const combinedBets = [...matchedBets, ...matchedFouledBets];

  // Spara allt i matchedBets.json
  fs.writeFileSync('matchedBets.json', JSON.stringify(combinedBets, null, 2));
  console.log('✅ Alla bets har sparats i matchedBets.json');

  combinedBets.forEach(bet => {
    if (bet.expectedValue > 0.8) {
      console.log(`\n🔗 MATCHAD BET:`);
      console.log(`🏆 Bet365: ${bet.player} | ${bet.category || bet.statKey} | Linje: ${bet.threshold} | ${bet.condition.toUpperCase()} | Odds: ${bet.odds} | Expected Value: ${bet.expectedValue} ${parseFloat(bet.expectedValue) > 1 ? "✅" : "❌"}`);
      console.log(`🎯 Perfect: ${bet.player} | Träff: ${bet.hitCount}/${bet.totalMatches} | SuccessRate: ${bet.successRate}`);
    }
  });
  
  console.log("\n\n----------------------------------------------------------------------------------");
})();




