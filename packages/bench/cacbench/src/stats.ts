/**
 * Statistical Analysis Utilities for CACBench Research Prototype
 * Implements paired McNemar testing, Wilcoxon signed-rank testing, and bootstrap CIs.
 * Conforms to Section 11 of the CAC paper.
 */

export interface McNemarResult {
  statistic: number;
  pValue: number;
  exactPValue: number;
  discordant: {
    n01: number; // A safe, B unsafe (discordant in favor of A)
    n10: number; // A unsafe, B safe (discordant in favor of B)
    total: number;
  };
  contingencyTable: {
    bothSafe: number;       // a: A safe, B safe
    aSafeBUnsafe: number;   // b: A safe, B unsafe
    aUnsafeBSafe: number;   // c: A unsafe, B safe
    bothUnsafe: number;     // d: A unsafe, B unsafe
  };
  significant: boolean;
}

/**
 * Computes exact two-sided McNemar test using the binomial distribution on discordant pairs.
 * Also provides the continuity-corrected asymptotic chi-square statistic for reporting continuity.
 */
export function computeMcNemarTest(
  outcomesAIsSafe: boolean[],
  outcomesBIsSafe: boolean[]
): McNemarResult {
  if (outcomesAIsSafe.length !== outcomesBIsSafe.length) {
    throw new Error("McNemar test requires paired samples of equal length");
  }

  let a = 0; // both safe
  let b = 0; // A safe, B unsafe (n01)
  let c = 0; // A unsafe, B safe (n10)
  let d = 0; // both unsafe

  for (let i = 0; i < outcomesAIsSafe.length; i++) {
    const safeA = outcomesAIsSafe[i];
    const safeB = outcomesBIsSafe[i];

    if (safeA && safeB) a++;
    else if (safeA && !safeB) b++;
    else if (!safeA && safeB) c++;
    else d++;
  }

  const discordant = b + c;
  if (discordant === 0) {
    return {
      statistic: 0,
      pValue: 1.0,
      exactPValue: 1.0,
      discordant: { n01: b, n10: c, total: 0 },
      contingencyTable: { bothSafe: a, aSafeBUnsafe: b, aUnsafeBSafe: c, bothUnsafe: d },
      significant: false,
    };
  }

  // Exact two-sided binomial p-value under H0: p = 0.5
  const exactP = exactBinomialTwoSidedPValue(b, discordant, 0.5);

  // Asymptotic continuity-corrected McNemar statistic: (|b - c| - 1)^2 / (b + c)
  const numerator = Math.max(0, Math.abs(b - c) - 1);
  const statistic = (numerator * numerator) / discordant;

  return {
    statistic,
    pValue: exactP, // Preferred primary p-value is exact
    exactPValue: exactP,
    discordant: { n01: b, n10: c, total: discordant },
    contingencyTable: { bothSafe: a, aSafeBUnsafe: b, aUnsafeBSafe: c, bothUnsafe: d },
    significant: exactP < 0.05,
  };
}

/**
 * Exact two-sided binomial p-value calculation.
 * For k successes in n trials with p=0.5:
 * P(X <= min(k, n-k)) * 2
 */
function exactBinomialTwoSidedPValue(k: number, n: number, p: number = 0.5): number {
  if (n === 0) return 1.0;
  const minK = Math.min(k, n - k);
  if (minK * 2 === n) return 1.0;

  let cumulativeP = 0;
  for (let i = 0; i <= minK; i++) {
    cumulativeP += binomialProbability(i, n, p);
  }

  return Math.min(1.0, 2.0 * cumulativeP);
}

function binomialProbability(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return Math.pow(0.5, n);

  // Compute via log-gamma to avoid numerical overflow with large n
  const logProb = logFactorial(n) - logFactorial(k) - logFactorial(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logProb);
}

function logFactorial(n: number): number {
  if (n <= 1) return 0;
  let res = 0;
  for (let i = 2; i <= n; i++) {
    res += Math.log(i);
  }
  return res;
}

/**
 * Standard error function approximation for Chi-squared 1-df survival function
 */
export function chiSquare1DfPValue(x: number): number {
  if (x <= 0) return 1.0;
  const z = Math.sqrt(x);
  return 2 * (1 - standardNormalCdf(z));
}

function standardNormalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Computes 95% bootstrap confidence intervals for a metric across trials.
 */
export function computeBootstrapCi(
  values: number[],
  numResamples: number = 1000,
  confidenceLevel: number = 0.95
): { mean: number; lower: number; upper: number } {
  if (values.length === 0) {
    return { mean: 0, lower: 0, upper: 0 };
  }

  const sampleMean = values.reduce((a, b) => a + b, 0) / values.length;
  const resampleMeans: number[] = [];

  for (let r = 0; r < numResamples; r++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      const idx = Math.floor(Math.random() * values.length);
      sum += values[idx]!;
    }
    resampleMeans.push(sum / values.length);
  }

  resampleMeans.sort((a, b) => a - b);
  const alpha = 1 - confidenceLevel;
  const lowerIdx = Math.floor((alpha / 2) * numResamples);
  const upperIdx = Math.floor((1 - alpha / 2) * numResamples);

  return {
    mean: sampleMean,
    lower: resampleMeans[lowerIdx] ?? sampleMean,
    upper: resampleMeans[upperIdx] ?? sampleMean,
  };
}

/**
 * Wilson score interval for a single proportion.
 */
export function wilsonScoreInterval(
  successes: number,
  total: number,
  confidenceLevel: number = 0.95
): { lower: number; upper: number } {
  if (total === 0) return { lower: 0, upper: 0 };
  if (confidenceLevel !== 0.95) throw new Error("Only a 95% Wilson interval is implemented");
  const z = 1.95996; // 95% two-sided
  const z2 = z * z;
  const p = successes / total;

  const center = (successes + z2 / 2) / (total + z2);
  const halfWidth = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / (1 + z2 / total);

  return {
    lower: Math.max(0, center - halfWidth),
    upper: Math.min(1, center + halfWidth),
  };
}

/**
 * Newcombe paired score interval for the difference of two paired proportions (Method 10).
 * Prevents degenerate [1.00, 1.00] or [0.00, 0.00] intervals when outcomes are extreme.
 */
export function computeNewcombePairedCi(
  a: number,
  b: number,
  c: number,
  d: number,
  confidenceLevel: number = 0.95
): [number, number] {
  const n = a + b + c + d;
  if (n === 0) return [0, 0];

  const p1 = (a + b) / n;
  const p2 = (a + c) / n;
  const diff = (b - c) / n;

  const ci1 = wilsonScoreInterval(a + b, n, confidenceLevel);
  const ci2 = wilsonScoreInterval(a + c, n, confidenceLevel);

  const l1 = ci1.lower;
  const u1 = ci1.upper;
  const l2 = ci2.lower;
  const u2 = ci2.upper;

  // Correlation between the two proportions
  const denom = (a + b) * (c + d) * (a + c) * (b + d);
  const r = denom > 0 ? (a * d - b * c) / Math.sqrt(denom) : 0;

  const lowerDelta = Math.sqrt(
    Math.pow(p1 - l1, 2) + Math.pow(u2 - p2, 2) - 2 * r * (p1 - l1) * (u2 - p2)
  );
  const upperDelta = Math.sqrt(
    Math.pow(u1 - p1, 2) + Math.pow(p2 - l2, 2) - 2 * r * (u1 - p1) * (p2 - l2)
  );

  const lower = Math.max(-1, diff - lowerDelta);
  const upper = Math.min(1, diff + upperDelta);

  return [Number(lower.toFixed(4)), Number(upper.toFixed(4))];
}

export interface PairedEffectSize {
  riskDifference: number;
  riskDifferenceCi: [number, number];
  matchedOddsRatio: number;
  matchedOddsRatioCi: [number, number];
  oddsRatioIsFinite: boolean;
  relativeRisk: number;
  relativeRiskCi: [number, number];
}

/**
 * Computes paired effect sizes: Risk Difference with Newcombe Paired CIs,
 * Matched Odds Ratio (with Haldane-Anscombe note), and Relative Risk.
 */
export function computePairedEffectSize(
  outcomesAIsSafe: boolean[],
  outcomesBIsSafe: boolean[]
): PairedEffectSize {
  const n = outcomesAIsSafe.length;
  if (n === 0) {
    return {
      riskDifference: 0,
      riskDifferenceCi: [0, 0],
      matchedOddsRatio: 1,
      matchedOddsRatioCi: [1, 1],
      oddsRatioIsFinite: true,
      relativeRisk: 1,
      relativeRiskCi: [1, 1],
    };
  }

  let a = 0; // both safe
  let b = 0; // A safe, B unsafe
  let c = 0; // A unsafe, B safe
  let d = 0; // both unsafe

  for (let i = 0; i < n; i++) {
    const sA = outcomesAIsSafe[i];
    const sB = outcomesBIsSafe[i];
    if (sA && sB) a++;
    else if (sA && !sB) b++;
    else if (!sA && sB) c++;
    else d++;
  }

  // Risk Difference (A - B) using Newcombe's paired score interval
  const rd = (b - c) / n;
  const rdCi = computeNewcombePairedCi(a, b, c, d);

  // Matched Odds Ratio
  const oddsRatioIsFinite = c > 0;
  const bCorr = b === 0 ? b + 0.5 : b;
  const cCorr = c === 0 ? c + 0.5 : c;
  const or = bCorr / cCorr;
  const z = 1.95996;
  const lnOrSe = Math.sqrt(1 / bCorr + 1 / cCorr);
  const orLower = Math.exp(Math.log(or) - z * lnOrSe);
  const orUpper = Math.exp(Math.log(or) + z * lnOrSe);

  // Relative Risk (P(A safe) / P(B safe))
  const pA = (a + b) / n;
  const pB = (a + c) / n;
  let rr = 1.0;
  let rrLower = 1.0;
  let rrUpper = 1.0;

  if (pB > 0) {
    rr = pA / pB;
    const lnRrSe = Math.sqrt(((n - (a + b)) / (a + b) + (n - (a + c)) / (a + c) - 2 * (d / ((a + b) * (a + c)))) / n);
    if (!Number.isNaN(lnRrSe) && Number.isFinite(lnRrSe)) {
      rrLower = Math.max(0, Math.exp(Math.log(rr) - z * lnRrSe));
      rrUpper = Math.exp(Math.log(rr) + z * lnRrSe);
    } else {
      rrLower = rr;
      rrUpper = rr;
    }
  } else {
    rr = pA > 0 ? Infinity : 1.0;
    rrLower = pA > 0 ? 1.0 : 1.0;
    rrUpper = Infinity;
  }

  return {
    riskDifference: Number(rd.toFixed(4)),
    riskDifferenceCi: rdCi,
    matchedOddsRatio: Number(or.toFixed(4)),
    matchedOddsRatioCi: [Number(orLower.toFixed(4)), Number(orUpper.toFixed(4))],
    oddsRatioIsFinite,
    relativeRisk: Number(Number.isFinite(rr) ? rr.toFixed(4) : "9999.0"),
    relativeRiskCi: [Number(rrLower.toFixed(4)), Number(Number.isFinite(rrUpper) ? rrUpper.toFixed(4) : "9999.0")],
  };
}

export interface WilcoxonResult {
  statisticW: number;
  zScore: number;
  pValue: number;
  nPairs: number;
  nNonZero: number;
  medianDifference: number;
  meanDifference: number;
  meanDifferenceCi: [number, number];
}

/**
 * Computes paired Wilcoxon signed-rank test for paired continuous metrics (e.g. latency/TTSR).
 */
export function computeWilcoxonSignedRankTest(
  valuesA: number[],
  valuesB: number[]
): WilcoxonResult {
  if (valuesA.length !== valuesB.length) {
    throw new Error("Wilcoxon signed-rank test requires equal length paired samples");
  }

  const nPairs = valuesA.length;
  const diffs: number[] = [];
  for (let i = 0; i < nPairs; i++) {
    diffs.push(valuesA[i]! - valuesB[i]!);
  }

  const nonZeroDiffs = diffs.filter((d) => Math.abs(d) > 1e-9);
  const nNonZero = nonZeroDiffs.length;

  if (nNonZero === 0) {
    return {
      statisticW: 0,
      zScore: 0,
      pValue: 1.0,
      nPairs,
      nNonZero: 0,
      medianDifference: 0,
      meanDifference: 0,
      meanDifferenceCi: [0, 0],
    };
  }

  // Rank absolute differences
  const sorted = nonZeroDiffs.map((d) => ({ diff: d, absDiff: Math.abs(d) }));
  sorted.sort((a, b) => a.absDiff - b.absDiff);

  const ranks: number[] = new Array(nNonZero);
  let i = 0;
  while (i < nNonZero) {
    let j = i;
    while (j < nNonZero - 1 && Math.abs(sorted[j + 1]!.absDiff - sorted[j]!.absDiff) < 1e-9) {
      j++;
    }
    const avgRank = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k++) {
      ranks[k] = avgRank;
    }
    i = j + 1;
  }

  let wPlus = 0;
  let wMinus = 0;
  for (let k = 0; k < nNonZero; k++) {
    if (sorted[k]!.diff > 0) wPlus += ranks[k]!;
    else wMinus += ranks[k]!;
  }

  const w = Math.min(wPlus, wMinus);
  const meanW = (nNonZero * (nNonZero + 1)) / 4;
  const varW = (nNonZero * (nNonZero + 1) * (2 * nNonZero + 1)) / 24;
  const seW = Math.sqrt(varW);
  const zScore = (w - meanW) / seW;

  // Two-sided normal approximation p-value
  const pValue = 2 * (1 - standardNormalCdf(Math.abs(zScore)));

  // Median and bootstrap mean CI
  sorted.sort((a, b) => a.diff - b.diff);
  const mid = Math.floor(nPairs / 2);
  const medianDiff = nPairs % 2 !== 0 ? sorted[mid]?.diff ?? 0 : ((sorted[mid - 1]?.diff ?? 0) + (sorted[mid]?.diff ?? 0)) / 2;
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / nPairs;
  const bootstrapCi = computeBootstrapCi(diffs);

  return {
    statisticW: w,
    zScore: Number(zScore.toFixed(3)),
    pValue: Number(Math.max(1e-10, pValue).toFixed(6)),
    nPairs,
    nNonZero,
    medianDifference: Number(medianDiff.toFixed(4)),
    meanDifference: Number(meanDiff.toFixed(4)),
    meanDifferenceCi: [Number(bootstrapCi.lower.toFixed(4)), Number(bootstrapCi.upper.toFixed(4))],
  };
}

/**
 * Applies the Holm-Bonferroni correction to a family of p-values.
 */
export function holmBonferroniCorrection(pValues: number[]): { adjustedPValues: number[]; significant: boolean[] } {
  const m = pValues.length;
  const indexed = pValues.map((p, idx) => ({ p, idx }));
  indexed.sort((a, b) => a.p - b.p);

  const adjusted = new Array<number>(m);
  let maxPrev = 0;

  for (let k = 0; k < m; k++) {
    const rawP = indexed[k]!.p;
    const factor = m - k;
    const adj = Math.min(1.0, Math.max(maxPrev, rawP * factor));
    maxPrev = adj;
    adjusted[indexed[k]!.idx] = Number(adj.toFixed(6));
  }

  const significant = adjusted.map((p) => p < 0.05);
  return { adjustedPValues: adjusted, significant };
}

/**
 * Calculates empirical percentiles (p50, p90, p99, max) from a numeric array.
 */
export function calculatePercentiles(values: number[]): {
  p50: number;
  p90: number;
  p99: number;
  max: number;
  mean: number;
  min: number;
} {
  if (values.length === 0) {
    return { p50: 0, p90: 0, p99: 0, max: 0, mean: 0, min: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;

  const p50Idx = Math.min(n - 1, Math.floor(n * 0.50));
  const p90Idx = Math.min(n - 1, Math.floor(n * 0.90));
  const p99Idx = Math.min(n - 1, Math.floor(n * 0.99));

  return {
    p50: sorted[p50Idx]!,
    p90: sorted[p90Idx]!,
    p99: sorted[p99Idx]!,
    max: sorted[n - 1]!,
    mean: Number(mean.toFixed(4)),
    min: sorted[0]!,
  };
}

