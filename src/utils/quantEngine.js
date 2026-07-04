// src/utils/quantEngine.js

// --- Basic Math & Stat Helpers ---

export function calculateMean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

export function calculateStdDev(arr, meanVal) {
  if (arr.length <= 1) return 0;
  const m = meanVal !== undefined ? meanVal : calculateMean(arr);
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - m, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// Gaussian elimination solver for Ax = B
// Used for Mean First Passage Time (MFPT)
export function solveLinearSystem(A, B) {
  const n = B.length;
  const a = A.map(row => [...row]);
  const b = [...B];

  for (let i = 0; i < n; i++) {
    let maxEl = Math.abs(a[i][i]);
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(a[k][i]) > maxEl) {
        maxEl = Math.abs(a[k][i]);
        maxRow = k;
      }
    }

    const tempRow = a[maxRow];
    a[maxRow] = a[i];
    a[i] = tempRow;
    const tempVal = b[maxRow];
    b[maxRow] = b[i];
    b[i] = tempVal;

    if (Math.abs(a[i][i]) < 1e-12) {
      return new Array(n).fill(0);
    }

    for (let k = i + 1; k < n; k++) {
      const c = -a[k][i] / a[i][i];
      for (let j = i; j < n; j++) {
        if (i === j) {
          a[k][j] = 0;
        } else {
          a[k][j] += c * a[i][j];
        }
      }
      b[k] += c * b[i];
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = b[i] / a[i][i];
    for (let k = i - 1; k >= 0; k--) {
      b[k] -= a[k][i] * x[i];
    }
  }
  return x;
}

// Normal Cumulative Distribution Function (CDF) approximation
export function normalCDF(z) {
  const p = 0.2316419;
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const t = 1.0 / (1.0 + p * Math.abs(z));
  const cdf = 1.0 - (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * 
              (b1 * t + b2 * t * t + b3 * Math.pow(t, 3) + b4 * Math.pow(t, 4) + b5 * Math.pow(t, 5));
  return z >= 0 ? cdf : 1.0 - cdf;
}

// Chi-Square Cumulative Distribution Function (CDF) approximation
export function chiSquareCDF(chiSq, df) {
  if (chiSq <= 0) return 0;
  const fraction = chiSq / df;
  const term1 = 2 / (9 * df);
  const Z = (Math.pow(fraction, 1/3) - (1 - term1)) / Math.sqrt(term1);
  return normalCDF(Z);
}

// --- Gaussian Hidden Markov Model (HMM) Core ---

// Gaussian probability density function (PDF)
export function gaussianPdf(x, mean, std) {
  const s = Math.max(std, 1e-5); // prevent divide-by-zero
  const variance = s * s;
  const exponent = -Math.pow(x - mean, 2) / (2 * variance);
  return (1 / (s * Math.sqrt(2 * Math.PI))) * Math.exp(exponent);
}

/**
 * Trains a Gaussian Emission HMM using Baum-Welch (EM) algorithm.
 * strictly on the provided trainingReturns (In-Sample).
 */
export function trainGaussianHMM(returns, numStates = 3, maxIterations = 20) {
  const T = returns.length;
  
  // 1. Smart Initialization of emission parameters by partitioning sorted returns
  const sorted = [...returns].sort((a, b) => a - b);
  const means = new Array(numStates);
  const stds = new Array(numStates);
  
  for (let i = 0; i < numStates; i++) {
    const startIdx = Math.floor((i / numStates) * T);
    const endIdx = Math.max(startIdx + 1, Math.floor(((i + 1) / numStates) * T));
    const partition = sorted.slice(startIdx, endIdx);
    means[i] = calculateMean(partition);
    stds[i] = Math.max(calculateStdDev(partition, means[i]), 1e-4);
  }
  
  // Initialize transition matrix A (diagonal-heavy)
  const A = Array.from({ length: numStates }, (_, i) => {
    const row = new Array(numStates).fill(0.3 / (numStates - 1));
    row[i] = 0.7; // high probability of staying in the same state
    return row;
  });
  
  // Initialize initial state distribution pi
  let pi = new Array(numStates).fill(1 / numStates);
  
  // EM iterations
  for (let iter = 0; iter < maxIterations; iter++) {
    // Forward variables alpha and scaling factors c
    const alpha = Array.from({ length: T }, () => new Array(numStates).fill(0));
    const c = new Array(T).fill(0);
    
    // Forward Pass - Initialization
    let sumAlpha0 = 0;
    for (let i = 0; i < numStates; i++) {
      alpha[0][i] = pi[i] * gaussianPdf(returns[0], means[i], stds[i]);
      sumAlpha0 += alpha[0][i];
    }
    c[0] = sumAlpha0 > 0 ? 1 / sumAlpha0 : 1;
    for (let i = 0; i < numStates; i++) {
      alpha[0][i] *= c[0];
    }
    
    // Forward Pass - Induction
    for (let t = 1; t < T; t++) {
      let sumAlphaT = 0;
      for (let i = 0; i < numStates; i++) {
        let sumA = 0;
        for (let j = 0; j < numStates; j++) {
          sumA += alpha[t - 1][j] * A[j][i];
        }
        alpha[t][i] = sumA * gaussianPdf(returns[t], means[i], stds[i]);
        sumAlphaT += alpha[t][i];
      }
      c[t] = sumAlphaT > 0 ? 1 / sumAlphaT : 1;
      for (let i = 0; i < numStates; i++) {
        alpha[t][i] *= c[t];
      }
    }
    
    // Backward Pass
    const beta = Array.from({ length: T }, () => new Array(numStates).fill(0));
    for (let i = 0; i < numStates; i++) {
      beta[T - 1][i] = c[T - 1];
    }
    
    for (let t = T - 2; t >= 0; t--) {
      for (let i = 0; i < numStates; i++) {
        let sumB = 0;
        for (let j = 0; j < numStates; j++) {
          sumB += A[i][j] * gaussianPdf(returns[t + 1], means[j], stds[j]) * beta[t + 1][j];
        }
        beta[t][i] = sumB * c[t];
      }
    }
    
    // Compute gamma (state occupancy probability) & xi (transition occupancy probability)
    const gamma = Array.from({ length: T }, () => new Array(numStates).fill(0));
    const xi = Array.from({ length: T - 1 }, () => 
      Array.from({ length: numStates }, () => new Array(numStates).fill(0))
    );
    
    for (let t = 0; t < T; t++) {
      let denom = 0;
      for (let i = 0; i < numStates; i++) {
        gamma[t][i] = alpha[t][i] * beta[t][i];
        denom += gamma[t][i];
      }
      for (let i = 0; i < numStates; i++) {
        gamma[t][i] = denom > 0 ? gamma[t][i] / denom : 0;
      }
    }
    
    for (let t = 0; t < T - 1; t++) {
      let denom = 0;
      for (let i = 0; i < numStates; i++) {
        for (let j = 0; j < numStates; j++) {
          xi[t][i][j] = alpha[t][i] * A[i][j] * gaussianPdf(returns[t + 1], means[j], stds[j]) * beta[t + 1][j];
          denom += xi[t][i][j];
        }
      }
      for (let i = 0; i < numStates; i++) {
        for (let j = 0; j < numStates; j++) {
          xi[t][i][j] = denom > 0 ? xi[t][i][j] / denom : 0;
        }
      }
    }
    
    // Re-estimate parameters (M-step)
    for (let i = 0; i < numStates; i++) {
      pi[i] = gamma[0][i];
    }
    
    for (let i = 0; i < numStates; i++) {
      let sumGammaI = 0;
      for (let t = 0; t < T - 1; t++) {
        sumGammaI += gamma[t][i];
      }
      for (let j = 0; j < numStates; j++) {
        let sumXi = 0;
        for (let t = 0; t < T - 1; t++) {
          sumXi += xi[t][i][j];
        }
        A[i][j] = sumGammaI > 0 ? sumXi / sumGammaI : A[i][j];
      }
    }
    
    for (let i = 0; i < numStates; i++) {
      let sumGammaT = 0;
      let sumMean = 0;
      for (let t = 0; t < T; t++) {
        sumGammaT += gamma[t][i];
        sumMean += gamma[t][i] * returns[t];
      }
      
      if (sumGammaT > 0) {
        const nextMean = sumMean / sumGammaT;
        let sumVar = 0;
        for (let t = 0; t < T; t++) {
          sumVar += gamma[t][i] * Math.pow(returns[t] - nextMean, 2);
        }
        means[i] = nextMean;
        stds[i] = Math.max(Math.sqrt(sumVar / sumGammaT), 1e-4); // standard deviation lower bound
      }
    }
  }
  
  // Sort states by mean return (ascending order: Bear, Neutral, Bull)
  // This maps unsupervised HMM states to structured logical labels
  const indices = Array.from({ length: numStates }, (_, i) => i);
  indices.sort((a, b) => means[a] - means[b]);
  
  const sortedMeans = indices.map(i => means[i]);
  const sortedStds = indices.map(i => stds[i]);
  const sortedPi = indices.map(i => pi[i]);
  
  const sortedA = Array.from({ length: numStates }, () => new Array(numStates).fill(0));
  for (let i = 0; i < numStates; i++) {
    for (let j = 0; j < numStates; j++) {
      sortedA[i][j] = A[indices[i]][indices[j]];
    }
  }
  
  return {
    means: sortedMeans,
    stds: sortedStds,
    A: sortedA,
    pi: sortedPi
  };
}

/**
 * Decodes state sequences using the log-probability Viterbi algorithm.
 */
export function runViterbi(returns, params) {
  const T = returns.length;
  const K = params.means.length;
  const { means, stds, A, pi } = params;
  
  const V = Array.from({ length: T }, () => new Array(K).fill(0));
  const ptr = Array.from({ length: T }, () => new Array(K).fill(0));
  
  // Initialization (t = 0)
  for (let i = 0; i < K; i++) {
    V[0][i] = Math.log(pi[i] || 1e-12) + Math.log(gaussianPdf(returns[0], means[i], stds[i]) || 1e-12);
  }
  
  // Induction (t = 1..T-1)
  for (let t = 1; t < T; t++) {
    for (let j = 0; j < K; j++) {
      let maxVal = -Infinity;
      let maxIdx = 0;
      
      for (let i = 0; i < K; i++) {
        const val = V[t - 1][i] + Math.log(A[i][j] || 1e-12);
        if (val > maxVal) {
          maxVal = val;
          maxIdx = i;
        }
      }
      V[t][j] = maxVal + Math.log(gaussianPdf(returns[t], means[j], stds[j] || 1e-12));
      ptr[t][j] = maxIdx;
    }
  }
  
  // Termination
  const states = new Array(T);
  let maxTerminalVal = -Infinity;
  let lastState = 0;
  for (let i = 0; i < K; i++) {
    if (V[T - 1][i] > maxTerminalVal) {
      maxTerminalVal = V[T - 1][i];
      lastState = i;
    }
  }
  states[T - 1] = lastState;
  
  // Backtracking
  for (let t = T - 2; t >= 0; t--) {
    states[t] = ptr[t + 1][states[t + 1]];
  }
  
  return states;
}

// --- Discretization and Quant Engine ---

export function calculateReturns(prices) {
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1].Close;
    const curr = prices[i].Close;
    const ret = (curr - prev) / (prev || 1);
    returns.push({
      Date: prices[i].Date,
      Price: curr,
      Return: ret
    });
  }
  return returns;
}

export function discretizeStates(prices, modelType, config = {}) {
  const returnsData = calculateReturns(prices);
  const N = returnsData.length;
  
  let states = []; // elements: { Date, Price, Return, State }
  let stateNames = [];

  // Determine split index for walk-forward training/split
  const trainingRatio = config.trainingRatio !== undefined ? config.trainingRatio : 70;
  const splitIndex = Math.floor(N * (trainingRatio / 100));

  if (modelType === 'UNSUPERVISED_HMM') {
    // 3 states: HMM Bear (0), HMM Neutral (1), HMM Bull (2)
    stateNames = ['HMM Bear', 'HMM Neutral', 'HMM Bull'];
    const numStates = 3;
    
    // Train HMM STRICTLY on In-Sample returns data
    const allReturns = returnsData.map(r => r.Return);
    const trainingReturns = allReturns.slice(0, splitIndex);
    
    // Edge case handling if training size is too small
    const validTrain = trainingReturns.length >= 10 ? trainingReturns : allReturns;
    const params = trainGaussianHMM(validTrain, numStates, 20);
    
    // Decode states using log-probability Viterbi algorithm
    const viterbiStates = runViterbi(allReturns, params);
    
    states = returnsData.map((r, idx) => ({
      ...r,
      State: viterbiStates[idx]
    }));

    // Cache trained parameter results on config output
    config.hmmParameters = params;
    
  } else if (modelType === 'RETURN_THRESHOLD') {
    // 3 states: Bear (0), Neutral (1), Bull (2)
    // Threshold is trained STRICTLY on In-Sample returns data
    const allReturns = returnsData.map(r => r.Return);
    const trainingReturns = allReturns.slice(0, splitIndex);
    
    const validTrain = trainingReturns.length >= 10 ? trainingReturns : allReturns;
    const meanVal = calculateMean(validTrain);
    const sdVal = calculateStdDev(validTrain, meanVal);
    
    const multiplier = config.sdMultiplier !== undefined ? config.sdMultiplier : 0.5;
    const threshold = config.usePercentThreshold 
      ? (config.percentThreshold / 100)
      : (multiplier * sdVal);
      
    stateNames = ['Bear', 'Neutral', 'Bull'];
    
    states = returnsData.map(r => {
      let state = 1; // Neutral
      if (r.Return < -threshold) {
        state = 0; // Bear
      } else if (r.Return > threshold) {
        state = 2; // Bull
      }
      return { ...r, State: state };
    });
    
  } else if (modelType === 'MA_CROSSOVER') {
    // 3 states: Bear (0), Neutral (1), Bull (2)
    const fastPeriod = config.fastPeriod || 20;
    const slowPeriod = config.slowPeriod || 50;
    
    stateNames = ['Bear', 'Neutral', 'Bull'];
    
    const smaFast = new Array(prices.length).fill(null);
    const smaSlow = new Array(prices.length).fill(null);
    
    let sumFast = 0;
    let sumSlow = 0;
    
    for (let i = 0; i < prices.length; i++) {
      const price = prices[i].Close;
      sumFast += price;
      sumSlow += price;
      
      if (i >= fastPeriod) sumFast -= prices[i - fastPeriod].Close;
      if (i >= slowPeriod) sumSlow -= prices[i - slowPeriod].Close;
      
      if (i >= fastPeriod - 1) smaFast[i] = sumFast / fastPeriod;
      if (i >= slowPeriod - 1) smaSlow[i] = sumSlow / slowPeriod;
    }
    
    for (let i = 1; i < prices.length; i++) {
      const r = returnsData[i - 1];
      let state = 1; // Neutral default
      
      if (i >= slowPeriod) {
        const fastVal = smaFast[i];
        const slowVal = smaSlow[i];
        const close = prices[i].Close;
        
        if (close < slowVal && fastVal < slowVal) {
          state = 0; // Bear
        } else if (close > slowVal && fastVal > slowVal) {
          state = 2; // Bull
        }
      }
      states.push({ ...r, State: state });
    }
    
  } else if (modelType === 'VOLATILITY_REGIME') {
    // 4 states: Low-Vol Bear (0), High-Vol Bear (1), Low-Vol Bull (2), High-Vol Bull (3)
    const volPeriod = config.volPeriod || 20;
    stateNames = ['Low-Vol Bear', 'High-Vol Bear', 'Low-Vol Bull', 'High-Vol Bull'];
    
    const allReturns = returnsData.map(r => r.Return);
    const rollingVols = new Array(N).fill(null);
    
    for (let i = volPeriod - 1; i < N; i++) {
      const window = allReturns.slice(i - volPeriod + 1, i + 1);
      rollingVols[i] = calculateStdDev(window);
    }
    
    // Find median volatility STRICTLY from In-Sample window to prevent out-of-sample data leakage
    const isVols = rollingVols.slice(0, splitIndex).filter(v => v !== null);
    const validVols = isVols.length > 5 ? isVols : rollingVols.filter(v => v !== null);
    validVols.sort((a, b) => a - b);
    const medianVol = validVols[Math.floor(validVols.length / 2)] || 0.01;
    
    for (let i = 0; i < N; i++) {
      const r = returnsData[i];
      let state = 2; // Low-Vol Bull
      
      if (i >= volPeriod) {
        const vol = rollingVols[i];
        const ret = r.Return;
        const isBull = ret >= 0;
        const isHighVol = vol > medianVol;
        
        if (!isBull && !isHighVol) state = 0;
        else if (!isBull && isHighVol) state = 1;
        else if (isBull && !isHighVol) state = 2;
        else if (isBull && isHighVol) state = 3;
      }
      states.push({ ...r, State: state });
    }
  }
  
  return { states, stateNames };
}

/**
 * Calculates transition counts and probabilities strictly on the In-Sample portion
 */
export function calculateTransitions(states, numStates, splitIndex) {
  const counts = Array.from({ length: numStates }, () => new Array(numStates).fill(0));
  
  // If no splitIndex is provided, use the entire series
  const trainingLimit = splitIndex !== undefined ? splitIndex : states.length;
  
  // Transition counts strictly within training (In-Sample) boundary
  for (let i = 0; i < trainingLimit - 1; i++) {
    const fromState = states[i].State;
    const toState = states[i + 1].State;
    counts[fromState][toState]++;
  }
  
  const matrix = counts.map((row, i) => {
    const rowSum = row.reduce((a, b) => a + b, 0);
    if (rowSum === 0) {
      const fallback = new Array(numStates).fill(0);
      fallback[i] = 1.0;
      return fallback;
    }
    return row.map(count => count / rowSum);
  });
  
  return { counts, matrix };
}

export function calculateSteadyState(matrix, maxIterations = 1000, tolerance = 1e-8) {
  const M = matrix.length;
  let pi = new Array(M).fill(1 / M);
  
  for (let iter = 0; iter < maxIterations; iter++) {
    const nextPi = new Array(M).fill(0);
    
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        nextPi[j] += pi[i] * matrix[i][j];
      }
    }
    
    let diff = 0;
    for (let i = 0; i < M; i++) {
      diff += Math.abs(nextPi[i] - pi[i]);
    }
    
    pi = nextPi;
    if (diff < tolerance) break;
  }
  
  return pi;
}

export function calculateMFPT(matrix) {
  const M = matrix.length;
  const mfpt = Array.from({ length: M }, () => new Array(M).fill(0));
  
  for (let j = 0; j < M; j++) {
    const states = [];
    for (let s = 0; s < M; s++) {
      if (s !== j) states.push(s);
    }
    const kCount = states.length;
    
    const A = Array.from({ length: kCount }, () => new Array(kCount).fill(0));
    const B = new Array(kCount).fill(1);
    
    for (let r = 0; r < kCount; r++) {
      const stateI = states[r];
      for (let c = 0; c < kCount; c++) {
        const stateK = states[c];
        if (r === c) {
          A[r][c] = 1 - matrix[stateI][stateK];
        } else {
          A[r][c] = -matrix[stateI][stateK];
        }
      }
    }
    
    const solutions = solveLinearSystem(A, B);
    
    for (let r = 0; r < kCount; r++) {
      const stateI = states[r];
      mfpt[stateI][j] = solutions[r];
    }
    mfpt[j][j] = 0;
  }
  
  return mfpt;
}

export function performMarkovPropertyTest(counts) {
  const M = counts.length;
  const rowSums = counts.map(row => row.reduce((a, b) => a + b, 0));
  const colSums = new Array(M).fill(0);
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      colSums[j] += counts[i][j];
    }
  }
  
  const totalTransitions = rowSums.reduce((a, b) => a + b, 0);
  
  if (totalTransitions === 0) {
    return { chiSq: 0, pValue: 1.0, df: (M - 1) * (M - 1), significant: false };
  }
  
  let chiSq = 0;
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      const observed = counts[i][j];
      const expected = (rowSums[i] * colSums[j]) / totalTransitions;
      
      if (expected > 0) {
        chiSq += Math.pow(observed - expected, 2) / expected;
      }
    }
  }
  
  const df = (M - 1) * (M - 1);
  const pValue = 1.0 - chiSquareCDF(chiSq, df);
  const significant = pValue < 0.05;
  
  return {
    chiSq: parseFloat(chiSq.toFixed(4)),
    pValue: parseFloat(pValue.toFixed(6)),
    df,
    significant
  };
}

/**
 * Backtests the transition probability-based strategy, supporting In-Sample and Out-of-Sample segments
 */
export function backtestMarkovStrategy(states, matrix, modelType, config = {}) {
  const N = states.length;
  if (N <= 1) return null;
  
  const txCost = config.transactionCost !== undefined ? config.transactionCost / 100 : 0.0005;
  const strategyType = config.strategyType || 'LONG_ONLY';
  
  const trainingRatio = config.trainingRatio !== undefined ? config.trainingRatio : 70;
  const splitIndex = Math.floor(N * (trainingRatio / 100));
  
  const M = matrix.length;
  
  // Calculate state mean returns strictly on the In-Sample (training) portion
  // to avoid out-of-sample data leakage
  const inSampleStateReturns = Array.from({ length: M }, () => []);
  for (let t = 0; t < splitIndex; t++) {
    inSampleStateReturns[states[t].State].push(states[t].Return);
  }
  const meanStateReturns = inSampleStateReturns.map(rets => calculateMean(rets));
  
  let positions = new Array(N).fill(0);
  let expectedReturns = new Array(N).fill(0);
  
  positions[0] = 0;
  
  for (let t = 1; t < N; t++) {
    const prevState = states[t - 1].State;
    
    // Expected Return calculation based on In-Sample transition matrix and state means
    let expRet = 0;
    for (let j = 0; j < M; j++) {
      expRet += matrix[prevState][j] * meanStateReturns[j];
    }
    expectedReturns[t] = expRet;
    
    let position = 0;
    
    if (config.signalMethod === 'PROBABILITY_THRESHOLD') {
      const bearState = 0;
      const bullState = M - 1;
      
      const probBull = matrix[prevState][bullState];
      const probBear = matrix[prevState][bearState];
      
      const buyProbThreshold = config.buyProbThreshold !== undefined ? config.buyProbThreshold / 100 : 0.45;
      const sellProbThreshold = config.sellProbThreshold !== undefined ? config.sellProbThreshold / 100 : 0.45;
      
      if (probBull > buyProbThreshold) {
        position = 1;
      } else if (probBear > sellProbThreshold) {
        position = strategyType === 'LONG_SHORT' ? -1 : 0;
      } else {
        position = 0;
      }
    } else {
      const buyThreshold = config.buyReturnThreshold !== undefined ? config.buyReturnThreshold / 10000 : 0.0002;
      const sellThreshold = config.sellReturnThreshold !== undefined ? config.sellReturnThreshold / 10000 : -0.0002;
      
      if (expRet > buyThreshold) {
        position = 1;
      } else if (expRet < sellThreshold) {
        position = strategyType === 'LONG_SHORT' ? -1 : 0;
      } else {
        position = 0;
      }
    }
    
    positions[t] = position;
  }
  
  // Performance arrays
  const dailyStratReturns = new Array(N).fill(0);
  const dailyBenchReturns = new Array(N).fill(0);
  const equityCurve = new Array(N).fill(1.0);
  const benchCurve = new Array(N).fill(1.0);
  
  let tradesCount = 0;
  
  for (let t = 1; t < N; t++) {
    const ret = states[t].Return;
    const pos = positions[t];
    const prevPos = positions[t - 1];
    
    dailyBenchReturns[t] = ret;
    benchCurve[t] = benchCurve[t - 1] * (1 + ret);
    
    let stratRet = pos * ret;
    if (pos !== prevPos) {
      const change = Math.abs(pos - prevPos);
      stratRet -= change * txCost;
      tradesCount++;
    }
    
    dailyStratReturns[t] = stratRet;
    equityCurve[t] = equityCurve[t - 1] * (1 + stratRet);
  }
  
  const isWeekendAsset = config.includeWeekends || false;
  const annFactor = isWeekendAsset ? 365 : 252;
  const riskFreeRate = config.riskFreeRate !== undefined ? config.riskFreeRate / 100 : 0.02;

  // Helper function to calculate segmented stats
  function getSegmentStats(startIndex, endIndex) {
    const len = endIndex - startIndex;
    if (len <= 5) {
      return {
        strat: { totalReturn: 0, annReturn: 0, volatility: 0, sharpe: 0, maxDrawdown: 0 },
        bench: { totalReturn: 0, annReturn: 0, volatility: 0, sharpe: 0, maxDrawdown: 0 }
      };
    }
    
    const segmentYears = len / annFactor;
    
    // Rescale curves to start at 1.0 for this segment
    const startEquity = equityCurve[startIndex];
    const endEquity = equityCurve[endIndex - 1];
    const segmentStratReturn = (endEquity / (startEquity || 1)) - 1.0;
    
    const startBench = benchCurve[startIndex];
    const endBench = benchCurve[endIndex - 1];
    const segmentBenchReturn = (endBench / (startBench || 1)) - 1.0;
    
    const segmentAnnStrat = Math.pow(endEquity / (startEquity || 1), 1 / (segmentYears || 1)) - 1.0;
    const segmentAnnBench = Math.pow(endBench / (startBench || 1), 1 / (segmentYears || 1)) - 1.0;
    
    const segmentStratRets = dailyStratReturns.slice(startIndex, endIndex);
    const segmentBenchRets = dailyBenchReturns.slice(startIndex, endIndex);
    
    const stratVol = calculateStdDev(segmentStratRets) * Math.sqrt(annFactor);
    const benchVol = calculateStdDev(segmentBenchRets) * Math.sqrt(annFactor);
    
    const stratSharpe = stratVol > 0 ? (segmentAnnStrat - riskFreeRate) / stratVol : 0;
    const benchSharpe = benchVol > 0 ? (segmentAnnBench - riskFreeRate) / benchVol : 0;
    
    // Drawdown
    let peakStrat = 0;
    let maxDdStrat = 0;
    let peakBench = 0;
    let maxDdBench = 0;
    
    for (let t = startIndex; t < endIndex; t++) {
      const eqVal = equityCurve[t] / startEquity;
      if (eqVal > peakStrat) peakStrat = eqVal;
      const ddStrat = peakStrat > 0 ? (peakStrat - eqVal) / peakStrat : 0;
      if (ddStrat > maxDdStrat) maxDdStrat = ddStrat;
      
      const beVal = benchCurve[t] / startBench;
      if (beVal > peakBench) peakBench = beVal;
      const ddBench = peakBench > 0 ? (peakBench - beVal) / peakBench : 0;
      if (ddBench > maxDdBench) maxDdBench = ddBench;
    }
    
    return {
      strat: {
        totalReturn: parseFloat((segmentStratReturn * 100).toFixed(2)),
        annReturn: parseFloat((segmentAnnStrat * 100).toFixed(2)),
        volatility: parseFloat((stratVol * 100).toFixed(2)),
        sharpe: parseFloat(stratSharpe.toFixed(2)),
        maxDrawdown: parseFloat((maxDdStrat * 100).toFixed(2))
      },
      bench: {
        totalReturn: parseFloat((segmentBenchReturn * 100).toFixed(2)),
        annReturn: parseFloat((segmentAnnBench * 100).toFixed(2)),
        volatility: parseFloat((benchVol * 100).toFixed(2)),
        sharpe: parseFloat(benchSharpe.toFixed(2)),
        maxDrawdown: parseFloat((maxDdBench * 100).toFixed(2))
      }
    };
  }

  // Calculate In-Sample, Out-of-Sample, and Overall metrics
  const inSampleMetrics = getSegmentStats(0, splitIndex);
  const outOfSampleMetrics = getSegmentStats(splitIndex, N);
  const overallMetrics = getSegmentStats(0, N);
  
  // Trades count per segment
  let isTrades = 0;
  for (let t = 1; t < splitIndex; t++) {
    if (positions[t] !== positions[t - 1]) isTrades++;
  }
  const oosTrades = tradesCount - isTrades;

  const timeline = states.map((s, idx) => ({
    Date: s.Date,
    Close: s.Price,
    State: s.State,
    Position: positions[idx],
    StratCumReturn: parseFloat(((equityCurve[idx] - 1.0) * 100).toFixed(2)),
    BenchCumReturn: parseFloat(((benchCurve[idx] - 1.0) * 100).toFixed(2)),
    ExpectedNextReturn: expectedReturns[idx]
  }));
  
  return {
    metrics: {
      overall: { ...overallMetrics, tradesCount },
      inSample: { ...inSampleMetrics, tradesCount: isTrades },
      outOfSample: { ...outOfSampleMetrics, tradesCount: oosTrades },
      totalDays: N,
      splitIndex
    },
    timeline,
    meanStateReturns: meanStateReturns.map(r => parseFloat((r * 100).toFixed(4)))
  };
}

/**
 * Simulates future price paths using Monte Carlo Markov Chain (MCMC)
 */
export function simulateMCMC(prices, states, matrix, numPaths = 100, horizon = 60) {
  const M = matrix.length;
  if (states.length === 0) return [];
  
  const lastPrice = prices[prices.length - 1].Close;
  const lastState = states[states.length - 1].State;
  
  const stateReturnPools = Array.from({ length: M }, () => []);
  states.forEach(s => {
    stateReturnPools[s.State].push(s.Return);
  });
  
  const stateStats = stateReturnPools.map(pool => {
    const mean = calculateMean(pool);
    const std = calculateStdDev(pool, mean);
    return { mean, std };
  });
  
  function randomNormalVal() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
  
  const paths = Array.from({ length: numPaths }, () => {
    const pathPrices = [lastPrice];
    const pathStates = [lastState];
    
    let currentPrice = lastPrice;
    let currentState = lastState;
    
    for (let step = 0; step < horizon; step++) {
      const row = matrix[currentState];
      const rVal = Math.random();
      
      let nextState = currentState;
      let cumulativeProb = 0;
      for (let s = 0; s < M; s++) {
        cumulativeProb += row[s];
        if (rVal <= cumulativeProb) {
          nextState = s;
          break;
        }
      }
      
      let ret = 0;
      const pool = stateReturnPools[nextState];
      
      if (pool.length > 5) {
        const randIndex = Math.floor(Math.random() * pool.length);
        ret = pool[randIndex];
      } else {
        const stats = stateStats[nextState];
        ret = stats.mean + stats.std * randomNormalVal();
      }
      
      currentPrice = currentPrice * (1 + ret);
      currentState = nextState;
      
      pathPrices.push(currentPrice);
      pathStates.push(currentState);
    }
    
    return { prices: pathPrices, states: pathStates };
  });
  
  const percentiles = [];
  const pValues = [10, 25, 50, 75, 90];
  
  for (let step = 0; step <= horizon; step++) {
    const stepPrices = paths.map(path => path.prices[step]);
    stepPrices.sort((a, b) => a - b);
    
    const pRecord = { Step: step };
    
    pValues.forEach(p => {
      const idx = Math.floor((p / 100) * (numPaths - 1));
      pRecord[`p${p}`] = parseFloat(stepPrices[idx].toFixed(2));
    });
    
    percentiles.push(pRecord);
  }
  
  const samplePaths = [];
  for (let i = 0; i < Math.min(5, numPaths); i++) {
    samplePaths.push(paths[i].prices.map(p => parseFloat(p.toFixed(2))));
  }
  
  return { percentiles, samplePaths };
}
