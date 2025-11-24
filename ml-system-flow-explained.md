# ML Betting System - Komplett Flöde (Nybörjarguide)

Denna guide förklarar hela flödet från att hämta odds från Unibet till att träna AI-modeller som kan förutspå fotbollsstatistik.

---

## 🎯 Målet

Skapa AI-modeller som kan förutspå fotbollsstatistik (t.ex. antal hörnor, skott, gula kort) bättre än manuellt skapade formler, för att hitta värdefulla betting-tillfällen.

---

## 📋 Hela Flödet (Steg-för-Steg)

### Steg 1: Hämta Odds från Unibet

**Script:** `scripts/run-unibet-backtests.js`

**Vad händer:**
- Ansluter till Unibet API
- Hämtar alla fotbollsmatcher för dagens datum
- För varje match: hämtar betting-odds (t.ex. "Över 10.5 hörnor @ 1.85")
- Kör **alla befintliga formler** (evPct, evPctOptaCombined, etc.) för att beräkna värde
- Sparar allt i MongoDB collection `unibet-backtest`

**Varför:**
Vi behöver faktiska betting-odds och prediktioner att jämföra med verkliga resultat senare.

**Vad sparas:**
```javascript
{
  _id: "arsenal-tottenham-2025-11-23",
  homeTeam: "Arsenal",
  awayTeam: "Tottenham Hotspur",
  matchDate: "2025-11-23",
  lines: [
    {
      statKey: "cornerKicks",
      line: 10.5,           // Betting-linje
      condition: "över",
      odds: 1.85,           // Odds från Unibet
      value: -5.2,          // EV% från våra formler
      evDetails: { ... },   // Alla formel-prediktioner
      actual: null,         // Fylls i senare
      win: null             // Fylls i senare
    }
  ]
}
```

---

### Steg 2: Rätta Results Efter Matcher Spelats

**Script:** `scripts/correct-unibet-backtest.js`

**Vad händer:**
- Kollar alla matcher i `unibet-backtest` där `actual` är `null`
- För varje match: letar upp verkliga matchstatistik i `teamstats` collection
- Extraherar faktiskt antal hörnor/skott/kort från matchen
- Uppdaterar `actual` och `win` för varje betting-line

**Varför:**
AI behöver veta vad som **faktiskt hände** i matchen för att lära sig. Utan `actual` results har vi ingen träningsdata.

**Exempel:**
```javascript
// Före correction:
{ line: 10.5, actual: null, win: null }

// Efter correction (matchen hade 12 hörnor):
{ line: 10.5, actual: 12, win: true }  // 12 > 10.5 = vinst på "över"
```

---

### Steg 3: Extrahera ML Training Data

**Script:** `machinelearning/data/extract/extractTrainingData.js`

**Vad händer:**
- Läser alla **rättade** matcher från `unibet-backtest`
- För varje betting-line, bygger en **feature vector** med 76 features:
  - Opta rankings
  - Team profiles (rank for/against)
  - WMA (Weighted Moving Average) av historiska matcher
  - Period-specifika stats (1ST/2ND/ALL)
  - Situational features (scoreFirst%, shotsPerMin baserat på game state)
- Delar upp data i **train/validation/test** baserat på datum
- Sparar som JSONL filer (en rad per sample)

**Varför:**
ML-modeller kan inte läsa rå MongoDB data. Vi måste omvandla till numeriska features som modellen kan lära sig från.

**Vad sparas:**
Filer: `machinelearning/data/datasets/cornerKicks_total_ALL_train.jsonl`

Varje rad:
```javascript
{
  raw_features: [17, 92.3, 20, 92.1, ...], // 76 numeriska värden
  formula_predictions: {                    // Vad formlerna gissade
    "evPct": -5.2,
    "evPctOptaCombined": -3.1,
    ...
  },
  target: 12,                               // RÄTT SVAR (actual)
  metadata: {
    homeTeam: "Arsenal",
    statKey: "cornerKicks",
    line: 10.5
  }
}
```

**Uppdelning:**
- **Train:** Matcher före 2025-11-22 (används för att lära modellen)
- **Val:** Matcher 2025-11-22 till 2025-11-23 (används för att tunga modellen)
- **Test:** Matcher efter 2025-11-23 (används för slutlig evaluering)

---

### Steg 4: Träna Tier 1 Modeller (Raw Features)

**Script:** `machinelearning/models/train/tier1_trainRawFeatures.py`

**Vad händer:**
- För varje statKey/scope/period (24 kombinationer):
  - Laddar train/val JSONL filer
  - Tränar en XGBoost-modell på de 76 raw features
  - Evaluerar på validation data
  - Sparar modellen som `.json` fil
  - Sparar metadata (MAE, R², feature importance)

**Varför:**
Tier 1 lär sig direkt från rådata (Opta ranks, WMA, etc.) utan att titta på andra formlers output. Detta är AI:ns "egen uppfattning" baserat på statistik.

**Vad sparas:**
- `models/trained/tier1/cornerKicks_total_ALL_raw.json` - Själva modellen
- `models/trained/tier1/cornerKicks_total_ALL_raw_metadata.json` - Stats

**Nuvarande Problem:**
Tier 1 presterar dåligt (R² = -2.4) för att vi har **för lite data** (bara 5-28 samples). Behöver minst 500+ matches för bra prestanda.

---

### Steg 5: Träna Tier 2 Modeller (Meta-Learning)

**Script:** `machinelearning/models/train/tier2_trainMetaLearner.py`

**Vad händer:**
- För varje statKey/scope/period:
  - Laddar samma train/val data
  - Bygger **meta-features** från:
    - Alla befintliga formlers prediktioner
    - Tier 1:s prediktion (om tillgänglig)
    - Consensus features (std dev, range, median av alla formler)
  - Tränar XGBoost att lära sig **vilken formel som är bäst**
  - Sparar Tier 2 modellen

**Varför:**
Tier 2 fungerar bra även med lite data! Istället för att lära sig från grunden, kombinerar den intelligent de formler vi redan har. Den lär sig "när ska jag lita på evPct vs evPctOptaCombined?".

**Feature Exempel:**
```javascript
// Tier 2 får:
{
  evPct: -5.2,
  evPctOptaCombined: -3.1, 
  evPctUniversalOptimized: -4.5,
  tier1_prediction: 11.2,
  formula_std: 1.8,        // Hur mycket formlerna är oense
  optimistic_formula: -3.1, // Högsta värdet
  pessimistic_formula: -5.2 // Lägsta värdet
}
```

Tier 2 lär sig: "Om std är låg OCH tier1 är nära optimistic → lita på optimistic"

---

## 🔄 Dagligt Workflow (Efter Setup)

Varje dag:

```bash
# 1. Hämta dagens matcher och odds
node scripts/run-unibet-backtests.js --date=TODAY

# 2. Efter matcher spelats (nästa dag): rätta results
node scripts/correct-unibet-backtest.js

# 3. Generera ny träningsdata
node machinelearning/data/extract/extractTrainingData.js

# 4. Träna om modellerna (när du har nog data)
cd machinelearning
python models/train/tier1_trainRawFeatures.py
python models/train/tier2_trainMetaLearner.py
```

---

## 📊 Varför Denna Arkitektur?

### Två-Tier System

**Tier 1 (Raw Features):**
- ✅ Kan hitta nya patterns som hand-crafted formler missar
- ❌ Behöver MYCKET data (1000+ matches)
- 🎯 Långsiktig potential: Bättre än alla formler när tränad

**Tier 2 (Meta-Learning):**
- ✅ Fungerar med LITE data (100+ matches)
- ✅ Kombinerar expertis från befintliga formler
- ✅ Kan börja användas DIREKT
- 🎯 Kortsiktig vinst: Bättre än enskilda formler redan nu

### Varför Inte Bara En Modell?

En enda stor modell skulle:
- Behöva ännu MER data
- Vara svårare att debugga
- Misslyckas totalt med lite data

Med två tiers:
- Tier 2 ger värde DIREKT (använder befintliga formler)
- Tier 1 förbättras gradvis och gör Tier 2 ännu bättre
- Flexibilitet: Kan använda bara Tier 2 tills Tier 1 är klar

---

## 🎓 Varför JSONL Format?

**JSONL** = JSON Lines = En JSON-object per rad

```jsonl
{"features": [1,2,3], "target": 5}
{"features": [4,5,6], "target": 10}
```

**Fördelar:**
- ✅ Lätt att strama-process (läs rad för rad)
- ✅ Python libraries älskar det
- ✅ Kan inspektera manuellt med text editor
- ✅ Git-friendly (kan se diff per sample)

---

## 📈 Förväntat Resultat Över Tid

| Vecka | Matches | Tier 1 R² | Tier 2 R² | Status |
|-------|---------|-----------|-----------|---------|
| 1 | 50 | -2.4 | -2.5 | 🔴 För lite data |
| 2 | 100 | -0.5 | 0.2 | 🟡 Tier 2 börjar fungera |
| 4 | 200 | 0.1 | 0.4 | 🟢 Tier 2 användbar |
| 8 | 500 | 0.3 | 0.6 | 🟢 Båda användbara |
| 12 | 1000 | 0.7 | 0.8 | ⭐ Bättre än hand-crafted |

---

## 🔧 Viktiga Filer

| Fil | Beskrivning |
|-----|-------------|
| `run-unibet-backtests.js` | Hämtar odds från Unibet |
| `correct-unibet-backtest.js` | Rättar predictions med actual results |
| `extractTrainingData.js` | Skapar ML training files |
| `tier1_trainRawFeatures.py` | Tränar rådata-modeller |
| `tier2_trainMetaLearner.py` | Tränar ensemble-modeller |
| `magic-formula-ml-features.md` | Lista på alla 76 features |

---

## ❓ Vanliga Frågor

**Q: Varför får jag R² = -2.4 när jag tränar?**  
A: För lite data! Du behöver 500+ matches. Tier 1 kommer förbättras automatiskt när du samlar mer data dagligen.

**Q: Kan jag använda modellerna nu?**  
A: Tier 2 kan börja användas när du har 200+ matches. Tier 1 behöver vänta lite längre.

**Q: Vad är "feature 23"?**  
A: Se `magic-formula-ml-features.md` för komplett lista. Feature 23 är `away_wma_{statKey}_medium_against`.

**Q: Varför splittas data på datum?**  
A: För att undvika "time travel" - modellen får inte se framtida matcher när den tränas. Annars fuskar den!

**Q: Vad händer om en match saknas i teamstats?**  
A: `correct-unibet-backtest.js` skippar den. Den rättas automatiskt senare när teamstats uppdateras.

---

**🎉 Slutsats:** Detta är ett helt automatiserat system som samlar data dagligen och förbättrar sig själv över tid. Ju mer data, desto bättre AI!
