# Prediction Pipeline New

Det här är en separat v2-pipeline för count-projectioner. Den lämnar nuvarande ML-filer orörda och använder nya `-new`-skript, egna datasetmappar, egna modellmappar och egna loggar.

## Filer

- `machinelearning/data/extract/extractTrainingData-new.js`
- `machinelearning/models/train/tier1_trainRawFeatures-new.py`
- `machinelearning/models/train/tier2_trainMetaLearner-new.py`
- `machinelearning/run-tier1-new.py`
- `machinelearning/run-tier2-new.py`

## Outputmappar

- Datasets: `machinelearning/data/datasets-new/`
- Tier 1: `machinelearning/models/trained/tier1-new/`
- Tier 2: `machinelearning/models/trained/tier2-new/`
- Logs: `machinelearning/logs/tier1_runs_new.json`, `machinelearning/logs/tier2_runs_new.json`

## Real körning

### 1. Extrahera nya dataset

```bash
node machinelearning/data/extract/extractTrainingData-new.js
```

### 2. Träna Tier 1

```bash
python machinelearning/run-tier1-new.py
```

### 2b. Bygg Tier 1-loggar igen efteråt

```bash
python machinelearning/log-tier1-new.py
```

Om du vill sammanställa en specifik träningsmapp i efterhand:

```bash
python machinelearning/log-tier1-new.py --output-dir machinelearning/models/trained/tier1-new-full
```

### 3. Träna Tier 2

```bash
python machinelearning/run-tier2-new.py
```

## Snabbare verifiering

### Begränsad extractor-körning

```bash
node machinelearning/data/extract/extractTrainingData-new.js --limit-backtests 50 --limit-teamstats 20
```

### Skippa superviserad teamstats-del

```bash
node machinelearning/data/extract/extractTrainingData-new.js --limit-backtests 50 --skip-supervised
```

### Begränsa Tier 1 till några kombos

```bash
python machinelearning/run-tier1-new.py --limit-combos 3
```

### Kör bara Tier 1-loggningen på nytt

```bash
python machinelearning/log-tier1-new.py
```

### Begränsa Tier 2 till några kombos

```bash
python machinelearning/run-tier2-new.py --limit-combos 3
```

### Kör en enskild combo

```bash
python machinelearning/run-tier1-new.py --combo shotsOnGoal_home_ALL
python machinelearning/run-tier2-new.py --combo shotsOnGoal_home_ALL
```

## Vad som är nytt metodiskt

- `strict` och `extended` feature modes
- walk-forward selection på `train + val`
- final retrain på `train + val`, rapportering på `test`
- explicit skip-metadata när datan är för tunn
- Tier 2 använder vald Tier 1-konfiguration per combo

## Viktiga begränsningar

- `extended` mode använder fortfarande `teamprofiles`, vilket kan vara mindre historiskt rent
- verklig extractor-körning beror på tillgänglig MongoDB-anslutning
- små kombos kan medvetet bli `skipped`
