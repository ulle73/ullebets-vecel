# Machine Learning - Betting Formula Optimization

This directory contains the ML pipeline for automatically learning optimal betting formulas.

## 📁 Structure

- `data/extract/` - Scripts to pull training data from MongoDB
- `data/datasets/` - Generated JSONL training files (gitignored)
- `models/train/` - Model training scripts
- `models/evaluate/` - Validation & evaluation
- `models/trained/` - Saved models (ONNX + JSON)
- `inference/` - Prediction code for production use
- `scripts/` - Automation scripts

## 🚀 Quick Start

### 1. Extract Training Data
```bash
node data/extract/extractTrainingData.js
```

### 2. Train Models
```bash
# JavaScript (TensorFlow.js)
node models/train/trainModel.js

# OR Python (XGBoost - recommended)
python models/train/trainModel.py
```

### 3. Evaluate
```bash
node models/evaluate/evaluate.js
```

### 4. Use in Production
Models are automatically loaded by `lib/backtest/formulas/evPctMLOptimized.js`

## 📊 Data Flow

```
MongoDB Collections
    ↓
extractTrainingData.js → datasets/*.jsonl
    ↓
trainModel.py → trained/*.onnx
    ↓
evPctMLOptimized.js (inference)
```

## 🔄 Automated Updates

Models retrain weekly via GitHub Actions (`.github/workflows/train-models.yml`)

## 📖 Full Documentation

See `/magic-formula.md` for complete architecture and implementation plan.
