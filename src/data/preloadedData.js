// src/data/preloadedData.js

// Standard Box-Muller transform for normal random variables
function randomNormal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Generate daily dates between start and end (inclusive)
function generateDates(startDateStr, endDateStr, includeWeekends) {
  const dates = [];
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const current = new Date(start);

  while (current <= end) {
    const dayOfWeek = current.getDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (includeWeekends || !isWeekend) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
    }
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// Generates a path between anchors using a Brownian Bridge
function generateBridgePath(anchors, includeWeekends, volScale) {
  const data = [];
  
  for (let i = 0; i < anchors.length - 1; i++) {
    const startAnchor = anchors[i];
    const endAnchor = anchors[i + 1];
    
    const dates = generateDates(startAnchor.date, endAnchor.date, includeWeekends);
    if (dates.length === 0) continue;
    
    // If it's not the last anchor segment, pop the last date to avoid duplication with the next segment's start
    if (i < anchors.length - 2) {
      dates.pop();
    }
    
    const N = dates.length;
    const P_A = startAnchor.price;
    const P_B = endAnchor.price;
    
    // Generate a standard random walk
    const W = new Array(N);
    W[0] = 0;
    for (let t = 1; t < N; t++) {
      W[t] = W[t - 1] + randomNormal();
    }
    
    // Construct Brownian Bridge and scale by volatility
    const logA = Math.log(P_A);
    const logB = Math.log(P_B);
    const W_N = W[N - 1];
    
    for (let t = 0; t < N; t++) {
      const fraction = t / (N - 1 || 1);
      const B_t = W[t] - fraction * W_N;
      const dailyVol = volScale / Math.sqrt(252);
      
      const logP = logA + fraction * (logB - logA) + dailyVol * B_t;
      const price = Math.exp(logP);
      
      if (t === 0) {
        data.push({ Date: dates[t], Close: parseFloat(P_A.toFixed(2)) });
      } else if (t === N - 1) {
        data.push({ Date: dates[t], Close: parseFloat(P_B.toFixed(2)) });
      } else {
        data.push({ Date: dates[t], Close: parseFloat(price.toFixed(2)) });
      }
    }
  }
  return data;
}

// US and Global historical anchors
const SPY_ANCHORS = [
  { date: '2020-01-02', price: 325.10 },
  { date: '2020-03-23', price: 222.90 },
  { date: '2020-09-02', price: 357.70 },
  { date: '2020-10-30', price: 326.50 },
  { date: '2021-12-31', price: 474.90 },
  { date: '2022-10-12', price: 356.50 },
  { date: '2023-07-31', price: 457.70 },
  { date: '2023-10-27', price: 410.70 },
  { date: '2024-07-16', price: 565.00 },
  { date: '2024-12-31', price: 572.00 },
  { date: '2025-06-30', price: 615.00 },
  { date: '2026-06-30', price: 648.50 }
];

const QQQ_ANCHORS = [
  { date: '2020-01-02', price: 216.10 },
  { date: '2020-03-23', price: 169.50 },
  { date: '2020-09-02', price: 302.20 },
  { date: '2021-11-19', price: 403.90 },
  { date: '2022-10-12', price: 254.30 },
  { date: '2023-07-18', price: 386.90 },
  { date: '2024-07-10', price: 501.00 },
  { date: '2024-12-31', price: 512.50 },
  { date: '2025-06-30', price: 560.00 },
  { date: '2026-06-30', price: 588.00 }
];

const BTC_ANCHORS = [
  { date: '2020-01-02', price: 6980.00 },
  { date: '2020-03-12', price: 4850.00 },
  { date: '2020-12-31', price: 29000.00 },
  { date: '2021-04-14', price: 63500.00 },
  { date: '2021-07-20', price: 29800.00 },
  { date: '2021-11-10', price: 67500.00 },
  { date: '2022-11-21', price: 15600.00 },
  { date: '2023-12-31', price: 42200.00 },
  { date: '2024-03-14', price: 73000.00 },
  { date: '2024-09-06', price: 53500.00 },
  { date: '2025-01-20', price: 104200.00 },
  { date: '2025-06-30', price: 92400.00 },
  { date: '2026-06-30', price: 108500.00 }
];

const GLD_ANCHORS = [
  { date: '2020-01-02', price: 143.20 },
  { date: '2020-08-06', price: 194.30 },
  { date: '2021-03-08', price: 157.80 },
  { date: '2022-03-08', price: 192.10 },
  { date: '2022-10-31', price: 151.80 },
  { date: '2023-12-31', price: 191.20 },
  { date: '2024-10-30', price: 257.40 },
  { date: '2025-06-30', price: 243.50 },
  { date: '2026-06-30', price: 278.20 }
];

// Indian Markets historical anchors
const NIFTY_ANCHORS = [
  { date: '2020-01-02', price: 12282.20 },
  { date: '2020-03-24', price: 7610.25 }, // Covid crash bottom
  { date: '2021-10-18', price: 18477.05 }, // Post-covid bull top
  { date: '2022-06-17', price: 15293.50 }, // Volatility correction bottom
  { date: '2023-12-01', price: 20267.90 },
  { date: '2024-09-27', price: 26277.35 }, // Historical peak
  { date: '2024-12-31', price: 24150.00 },
  { date: '2025-06-30', price: 25800.00 },
  { date: '2026-06-30', price: 26950.00 }
];

const SENSEX_ANCHORS = [
  { date: '2020-01-02', price: 41626.60 },
  { date: '2020-03-24', price: 25981.20 },
  { date: '2021-10-18', price: 61765.60 },
  { date: '2022-06-17', price: 51360.40 },
  { date: '2023-12-31', price: 72240.20 },
  { date: '2024-09-27', price: 85978.25 },
  { date: '2024-12-31', price: 79200.00 },
  { date: '2025-06-30', price: 84600.00 },
  { date: '2026-06-30', price: 88300.00 }
];

const RELIANCE_ANCHORS = [
  { date: '2020-01-02', price: 1510.50 },
  { date: '2020-03-23', price: 884.00 },
  { date: '2021-10-19', price: 2731.85 },
  { date: '2022-06-17', price: 2400.20 },
  { date: '2023-12-31', price: 2584.95 },
  { date: '2024-07-08', price: 3200.00 },
  { date: '2024-12-31', price: 2870.00 },
  { date: '2025-06-30', price: 3040.00 },
  { date: '2026-06-30', price: 3190.00 }
];

const TCS_ANCHORS = [
  { date: '2020-01-02', price: 2161.70 },
  { date: '2020-03-23', price: 1630.00 },
  { date: '2021-10-08', price: 3935.00 },
  { date: '2022-07-15', price: 2995.00 },
  { date: '2023-12-31', price: 3795.00 },
  { date: '2024-09-02', price: 4500.00 },
  { date: '2024-12-31', price: 4210.00 },
  { date: '2025-06-30', price: 4420.00 },
  { date: '2026-06-30', price: 4680.00 }
];

let cache = null;

export function getPreloadedAssets() {
  if (cache) return cache;
  
  cache = {
    // US & Global
    SPY: generateBridgePath(SPY_ANCHORS, false, 0.16),
    QQQ: generateBridgePath(QQQ_ANCHORS, false, 0.22),
    BTC: generateBridgePath(BTC_ANCHORS, true, 0.65),
    GLD: generateBridgePath(GLD_ANCHORS, false, 0.13),
    
    // Indian
    NIFTY50: generateBridgePath(NIFTY_ANCHORS, false, 0.15),
    SENSEX: generateBridgePath(SENSEX_ANCHORS, false, 0.14),
    RELIANCE: generateBridgePath(RELIANCE_ANCHORS, false, 0.21),
    TCS: generateBridgePath(TCS_ANCHORS, false, 0.19)
  };
  
  return cache;
}
