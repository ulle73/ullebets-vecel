import { extractClosingOdds } from "../lib/utils/closingOdds.js";

// Test extractClosingOdds with different data structures
const testMatchData = {
  // Standard structure that works
  standard: {
    closingOdds: {
      home: 2.1,
      draw: 3.2,
      away: 3.5
    }
  },

  // Alternative structure
  alternative: {
    odds: {
      closing: {
        home: 2.0,
        draw: 3.1,
        away: 3.8
      }
    }
  },

  // Nested structure
  nested: {
    matchDetails: {
      odds: {
        closing: {
          home: 1.9,
          draw: 3.4,
          away: 4.0
        }
      }
    }
  },

  // Array-based structure
  arrayBased: {
    betting: {
      markets: [{
        outcomes: [
          { label: "1", value: 2.2 },
          { label: "X", value: 3.3 },
          { label: "2", value: 3.6 }
        ]
      }]
    }
  },

  // Hypothetical Genoa structure (if different)
  genoaStyle: {
    full: {
      odds: {
        closingOdds: {
          "1": 2.1,
          "X": 3.2,
          "2": 3.5
        }
      }
    }
  }
};

console.log("=== Testing extractClosingOdds with different structures ===");

for (const [name, match] of Object.entries(testMatchData)) {
  const result = extractClosingOdds(match);
  console.log(`${name}:`, {
    hasOdds: !!result,
    values: result?.values,
    winner: result?.winner
  });
}

// Test with actual Genoa data if available
console.log("\n=== Testing with potential Genoa data structures ===");

// Test what happens if odds are in full.varje
const genoaMatch = {
  full: {
    odds: {
      home: 2.1,
      draw: 3.2,
      away: 3.5
    }
  }
};

console.log("Genoa full.odds structure:", extractClosingOdds(genoaMatch));

// Test if odds are nested deeper
const genoaMatch2 = {
  full: {
    varje: {
      odds: {
        closing: {
          home: 2.1,
          draw: 3.2,
          away: 3.5
        }
      }
    }
  }
};

console.log("Genoa full.varje.odds structure:", extractClosingOdds(genoaMatch2));

// Test if odds are directly in full.varje
const genoaMatch3 = {
  full: {
    varje: {
      odds: {
        home: 2.1,
        draw: 3.2,
        away: 3.5
      }
    }
  }
};

console.log("Genoa full.varje.odds direct:", extractClosingOdds(genoaMatch3));

// Test if odds are in full.odds
const genoaMatch4 = {
  full: {
    odds: {
      home: 2.1,
      draw: 3.2,
      away: 3.5
    }
  }
};

console.log("Genoa full.odds structure:", extractClosingOdds(genoaMatch4));