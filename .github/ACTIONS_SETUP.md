# GitHub Actions Setup for ML Pipeline

## Required Secrets

Go to your repository settings → Secrets and variables → Actions → New repository secret

Add the following secrets:

### 1. MONGODB_URI
Your MongoDB connection string:
```
mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
```

### 2. MONGODB_DB (optional)
Database name (default: `app`)
```
app
```

## Workflow Schedule

The workflow runs:
- **Automatically**: Daily at 6 AM CET (5 AM UTC)
- **Manually**: Via "Actions" tab → "Daily ML Model Training" → "Run workflow"

## What It Does

1. ✅ Corrects previous day's backtest predictions with actual results
2. ✅ Extracts fresh training data from MongoDB
3. ✅ Trains Tier 1 models (raw features)
4. ✅ Trains Tier 2 models (meta-learning)
5. ✅ Commits and pushes updated models to repository

## Manual Trigger Options

- `skip_correction`: Set to `true` if you already corrected backtests manually

## Monitoring

Check workflow runs in the "Actions" tab. Each run shows:
- Number of matches corrected
- Training data samples generated
- Models trained
- Performance metrics

## First Time Setup

After adding secrets:

1. Push the workflow file to your repository
2. Go to Actions tab
3. Click "Daily ML Model Training"
4. Click "Run workflow" to test it manually
5. Verify models are committed to `machinelearning/models/trained/`

## Troubleshooting

**Workflow fails with "MONGODB_URI not found"**
→ Make sure you added the secret correctly

**No models committed**
→ Check if training actually improved models (git only commits if there are changes)

**Python dependencies fail**
→ Update `machinelearning/requirements.txt` with compatible versions
