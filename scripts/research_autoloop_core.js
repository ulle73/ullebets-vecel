function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inSingle || inDouble || inTemplate) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (inSingle && char === "'") inSingle = false;
      else if (inDouble && char === "\"") inDouble = false;
      else if (inTemplate && char === "`") inTemplate = false;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (char === "'") {
      inSingle = true;
      continue;
    }

    if (char === "\"") {
      inDouble = true;
      continue;
    }

    if (char === "`") {
      inTemplate = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  throw new Error("Could not find matching closing brace");
}

function findDeclarationObjectRange(source, declarationName) {
  const declarationPattern = new RegExp(`(?:export\\s+)?const\\s+${escapeRegExp(declarationName)}\\s*=\\s*\\{`);
  const match = declarationPattern.exec(source);
  if (!match) {
    throw new Error(`Declaration ${declarationName} not found`);
  }

  const openIndex = source.indexOf("{", match.index);
  const closeIndex = findMatchingBrace(source, openIndex);
  return { start: openIndex, end: closeIndex + 1 };
}

function findNestedObjectRange(source, range, propertyName) {
  const propPattern = `(?:["']?${escapeRegExp(propertyName)}["']?)`;
  const matcher = new RegExp(`${propPattern}\\s*:\\s*\\{`, "m");
  const slice = source.slice(range.start, range.end);
  const match = matcher.exec(slice);
  if (!match) {
    throw new Error(`Object property ${propertyName} not found`);
  }

  const absoluteStart = range.start + match.index + match[0].lastIndexOf("{");
  const absoluteEnd = findMatchingBrace(source, absoluteStart) + 1;
  return { start: absoluteStart, end: absoluteEnd };
}

function formatNumberLike(originalValue, nextValue) {
  if (String(originalValue).includes(".")) {
    const decimals = String(originalValue).split(".")[1].length;
    return Number(nextValue).toFixed(decimals);
  }
  return String(Math.round(Number(nextValue)));
}

function findNumericPropertyMatch(source, range, propertyName) {
  const propPattern = `(^[ \\t]*(?:["']?${escapeRegExp(propertyName)}["']?)\\s*:\\s*)(-?\\d+(?:\\.\\d+)?)(\\s*,?)`;
  const slice = source.slice(range.start, range.end);
  const matcher = new RegExp(propPattern, "m");
  const match = matcher.exec(slice);
  if (!match) {
    throw new Error(`Numeric property ${propertyName} not found`);
  }
  return { match, slice };
}

function findStringArrayPropertyMatch(source, range, propertyName) {
  const propPattern = `(^[ \\t]*(?:["']?${escapeRegExp(propertyName)}["']?)\\s*:\\s*)(\\[(?:.|\\r|\\n)*?\\])(\\s*,?)`;
  const slice = source.slice(range.start, range.end);
  const matcher = new RegExp(propPattern, "m");
  const match = matcher.exec(slice);
  if (!match) {
    throw new Error(`String array property ${propertyName} not found`);
  }
  return { match, slice };
}

function countSatisfiedGuardrails(guardrails = {}) {
  return Object.entries(guardrails)
    .filter(([key, value]) => key !== "ok" && typeof value === "boolean" && value)
    .length;
}

function getFocusMetric(candidate, focus) {
  if (!candidate || typeof candidate !== "object") return 0;
  if (focus === "roi") return Number(candidate?.metrics?.roiPct) || 0;
  if (focus === "beatClose") return Number(candidate?.metrics?.beatClosePct) || 0;
  if (focus === "avgClv") return Number(candidate?.metrics?.avgClv) || 0;
  return Number(candidate?.researchScore) || 0;
}

function focusLabel(focus) {
  if (focus === "roi") return "ROI";
  if (focus === "beatClose") return "beat-close";
  if (focus === "avgClv") return "avg-CLV";
  return "research score";
}

export function parseEvalJson(stdout) {
  const trimmed = String(stdout || "").trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart === -1) {
    throw new Error("research_eval did not return JSON");
  }
  return JSON.parse(trimmed.slice(jsonStart));
}

export function decideExperimentStatus({ baseline, candidate, focus = "researchScore" }) {
  const baselineGuardrails = countSatisfiedGuardrails(baseline?.guardrails);
  const candidateGuardrails = countSatisfiedGuardrails(candidate?.guardrails);

  if (candidateGuardrails < baselineGuardrails) {
    return {
      status: "discard",
      reason: `guardrail regression (${candidateGuardrails}/${baselineGuardrails})`,
    };
  }

  const baselineMetric = getFocusMetric(baseline, focus);
  const candidateMetric = getFocusMetric(candidate, focus);

  if (candidateMetric > baselineMetric) {
    return {
      status: "keep",
      reason: `${focusLabel(focus)} improved (${baselineMetric} -> ${candidateMetric})`,
    };
  }

  return {
    status: "discard",
    reason: `${focusLabel(focus)} did not improve (${baselineMetric} -> ${candidateMetric})`,
  };
}

export function applyNumericMutation(source, mutation) {
  const { declarationName, propertyPath = [], nextValue } = mutation || {};
  if (!declarationName || !Array.isArray(propertyPath) || !propertyPath.length) {
    throw new Error("Invalid numeric mutation");
  }

  let range = findDeclarationObjectRange(source, declarationName);
  for (let i = 0; i < propertyPath.length - 1; i += 1) {
    range = findNestedObjectRange(source, range, propertyPath[i]);
  }

  const targetProp = propertyPath[propertyPath.length - 1];
  const { match } = findNumericPropertyMatch(source, range, targetProp);

  const formatted = formatNumberLike(match[2], nextValue);
  const absoluteStart = range.start + match.index;
  const absoluteEnd = absoluteStart + match[0].length;
  const replacement = `${match[1]}${formatted}${match[3]}`;
  return `${source.slice(0, absoluteStart)}${replacement}${source.slice(absoluteEnd)}`;
}

export function readNumericProperty(source, declarationName, propertyPath = []) {
  if (!declarationName || !Array.isArray(propertyPath) || !propertyPath.length) {
    throw new Error("Invalid numeric property path");
  }

  let range = findDeclarationObjectRange(source, declarationName);
  for (let i = 0; i < propertyPath.length - 1; i += 1) {
    range = findNestedObjectRange(source, range, propertyPath[i]);
  }

  const targetProp = propertyPath[propertyPath.length - 1];
  const { match } = findNumericPropertyMatch(source, range, targetProp);
  return Number(match[2]);
}

export function readStringArrayProperty(source, declarationName, propertyPath = []) {
  if (!declarationName || !Array.isArray(propertyPath) || !propertyPath.length) {
    throw new Error("Invalid string array property path");
  }

  let range = findDeclarationObjectRange(source, declarationName);
  for (let i = 0; i < propertyPath.length - 1; i += 1) {
    range = findNestedObjectRange(source, range, propertyPath[i]);
  }

  const targetProp = propertyPath[propertyPath.length - 1];
  const { match } = findStringArrayPropertyMatch(source, range, targetProp);
  return JSON.parse(match[2].replace(/'/g, "\""));
}

export function applyStringArrayMutation(source, mutation) {
  const { declarationName, propertyPath = [], nextValue } = mutation || {};
  if (
    !declarationName ||
    !Array.isArray(propertyPath) ||
    !propertyPath.length ||
    !Array.isArray(nextValue)
  ) {
    throw new Error("Invalid string array mutation");
  }

  let range = findDeclarationObjectRange(source, declarationName);
  for (let i = 0; i < propertyPath.length - 1; i += 1) {
    range = findNestedObjectRange(source, range, propertyPath[i]);
  }

  const targetProp = propertyPath[propertyPath.length - 1];
  const { match } = findStringArrayPropertyMatch(source, range, targetProp);

  const formatted = `[${nextValue.map((value) => JSON.stringify(String(value))).join(", ")}]`;
  const absoluteStart = range.start + match.index;
  const absoluteEnd = absoluteStart + match[0].length;
  const replacement = `${match[1]}${formatted}${match[3]}`;
  return `${source.slice(0, absoluteStart)}${replacement}${source.slice(absoluteEnd)}`;
}

export function applyMutationSet(source, experiment) {
  return (experiment?.mutations || []).reduce((nextSource, mutation) => applyNumericMutation(nextSource, mutation), source);
}

export const EXPERIMENT_CATALOG = [
  {
    id: "roi_edge_up",
    description: "raise balanced edge weight, trim confidence",
    mutations: [
      { declarationName: "STRATEGY_PROFILES", propertyPath: ["balanced", "weights", "edge"], nextValue: 0.34 },
      { declarationName: "STRATEGY_PROFILES", propertyPath: ["balanced", "weights", "confidence"], nextValue: 0.18 },
    ],
  },
  {
    id: "roi_learning_up",
    description: "raise balanced learning weight, trim market",
    mutations: [
      { declarationName: "STRATEGY_PROFILES", propertyPath: ["balanced", "weights", "learning"], nextValue: 1.2 },
      { declarationName: "STRATEGY_PROFILES", propertyPath: ["balanced", "weights", "market"], nextValue: 0.10 },
    ],
  },
  {
    id: "roi_risk_down",
    description: "reduce balanced risk penalty slightly",
    mutations: [
      { declarationName: "STRATEGY_PROFILES", propertyPath: ["balanced", "weights", "risk"], nextValue: 0.88 },
    ],
  },
  {
    id: "roi_proof_up",
    description: "increase balanced proof weight",
    mutations: [
      { declarationName: "STRATEGY_PROFILES", propertyPath: ["balanced", "weights", "proof"], nextValue: 0.10 },
    ],
  },
  {
    id: "roi_sample_down",
    description: "lower balanced minimum sample size",
    mutations: [
      { declarationName: "STRATEGY_PROFILES", propertyPath: ["balanced", "minSampleSize"], nextValue: 5 },
    ],
  },
  {
    id: "roi_agreement_down",
    description: "lower balanced minimum agreement threshold",
    mutations: [
      { declarationName: "STRATEGY_PROFILES", propertyPath: ["balanced", "minAgreementPct"], nextValue: 35 },
    ],
  },
  {
    id: "roi_shots_priority",
    description: "raise shots-on-goal and corners market priors",
    mutations: [
      { declarationName: "STAT_MARKET_PRIORS", propertyPath: ["shotsOnGoal"], nextValue: 90 },
      { declarationName: "STAT_MARKET_PRIORS", propertyPath: ["cornerKicks"], nextValue: 86 },
    ],
  },
  {
    id: "roi_price_center_up",
    description: "shift ideal odds center upward",
    mutations: [
      { declarationName: "SCORE_SHAPING", propertyPath: ["idealPriceCenter"], nextValue: 2.20 },
    ],
  },
  {
    id: "roi_price_tighter",
    description: "tighten price distance penalty",
    mutations: [
      { declarationName: "SCORE_SHAPING", propertyPath: ["priceDistanceWeight"], nextValue: 65 },
    ],
  },
  {
    id: "roi_learning_threshold_down",
    description: "allow learning adjustments with fewer historical bets",
    mutations: [
      { declarationName: "PROOF_THRESHOLDS", propertyPath: ["learningReadyMinBets"], nextValue: 14 },
      { declarationName: "PROOF_THRESHOLDS", propertyPath: ["learningMinConfidencePct"], nextValue: 30 },
    ],
  },
];
