// src/components/QuantDashboard.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Upload,
  Percent,
  Activity,
  BarChart2,
  DollarSign,
  Calendar,
  AlertCircle,
  Play,
  ArrowRight,
  Info,
  Maximize2
} from 'lucide-react';

import { getPreloadedAssets } from '../data/preloadedData';
import {
  discretizeStates,
  calculateTransitions,
  calculateSteadyState,
  calculateMFPT,
  performMarkovPropertyTest,
  backtestMarkovStrategy,
  simulateMCMC,
  calculateMean,
  calculateStdDev
} from '../utils/quantEngine';
import StateDiagram from './StateDiagram';
import MetricCard from './MetricCard';

// Register ChartJS elements
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function QuantDashboard() {
  const preloadedAssets = useMemo(() => getPreloadedAssets(), []);

  // Configuration States
  const [selectedAsset, setSelectedAsset] = useState('SPY'); // SPY, QQQ, BTC, GLD, NIFTY50, SENSEX, RELIANCE, TCS, UPLOADED
  const [uploadedData, setUploadedData] = useState(null);
  const [uploadedFilename, setUploadedFilename] = useState('');
  const [uploadError, setUploadError] = useState('');
  
  // Mutable price series for streaming
  const [chartSeries, setChartSeries] = useState([]);
  const [isLiveFeedActive, setIsLiveFeedActive] = useState(false);

  // Model Parameters
  const [modelType, setModelType] = useState('UNSUPERVISED_HMM'); // UNSUPERVISED_HMM, RETURN_THRESHOLD, MA_CROSSOVER, VOLATILITY_REGIME
  const [trainingRatio, setTrainingRatio] = useState(70); // % training split
  const [sdMultiplier, setSdMultiplier] = useState(0.5);
  const [percentThreshold, setPercentThreshold] = useState(0.5);
  const [usePercentThreshold, setUsePercentThreshold] = useState(false);
  const [fastPeriod, setFastPeriod] = useState(20);
  const [slowPeriod, setSlowPeriod] = useState(50);
  const [volPeriod, setVolPeriod] = useState(20);

  // Strategy Parameters
  const [strategyType, setStrategyType] = useState('LONG_ONLY'); // LONG_ONLY, LONG_SHORT
  const [signalMethod, setSignalMethod] = useState('EXPECTED_RETURN_MOMENTUM'); // EXPECTED_RETURN_MOMENTUM, PROBABILITY_THRESHOLD
  const [buyReturnThreshold, setBuyReturnThreshold] = useState(2.0); // basis points
  const [sellReturnThreshold, setSellReturnThreshold] = useState(-2.0); // basis points
  const [buyProbThreshold, setBuyProbThreshold] = useState(42); // %
  const [sellProbThreshold, setSellProbThreshold] = useState(42); // %
  const [transactionCost, setTransactionCost] = useState(0.05); // %
  const [riskFreeRate, setRiskFreeRate] = useState(2.0); // %

  // Monte Carlo parameters
  const [mcmcPaths, setMcmcPaths] = useState(150);
  const [mcmcHorizon, setMcmcHorizon] = useState(60); 
  const [mcmcTriggerSeed, setMcmcTriggerSeed] = useState(0); 

  // UI State
  const [activeTab, setActiveTab] = useState('markov'); 
  const fileInputRef = useRef(null);

  // Synchronize base series when selected asset or uploaded data changes
  useEffect(() => {
    if (selectedAsset === 'UPLOADED') {
      setChartSeries(uploadedData || []);
    } else {
      setChartSeries(preloadedAssets[selectedAsset] || []);
    }
    setIsLiveFeedActive(false); // Disable stream when switching assets
  }, [selectedAsset, uploadedData, preloadedAssets]);

  // Real-Time Price Feed Simulator Loop
  useEffect(() => {
    let intervalId = null;
    if (isLiveFeedActive && chartSeries.length > 0) {
      intervalId = setInterval(() => {
        setChartSeries(prevSeries => {
          if (prevSeries.length === 0) return prevSeries;
          const lastPoint = prevSeries[prevSeries.length - 1];

          // Compute recent returns (up to last 60 days) to extract empirical daily volatility
          const sampleLength = Math.min(prevSeries.length, 60);
          const returns = [];
          for (let i = 1; i < sampleLength; i++) {
            const p0 = prevSeries[prevSeries.length - i - 1].Close;
            const p1 = prevSeries[prevSeries.length - i].Close;
            returns.push((p1 - p0) / (p0 || 1));
          }
          
          const meanVal = calculateMean(returns);
          const volVal = calculateStdDev(returns, meanVal) || 0.01;

          // Box-Muller random normal Z
          let u = 0, v = 0;
          while (u === 0) u = Math.random();
          while (v === 0) v = Math.random();
          const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);

          // Simulate simple daily return with minor positive drift
          const drift = 0.00015; 
          const simReturn = drift + volVal * z;
          const nextPrice = lastPoint.Close * (1 + simReturn);

          // Increment Date by 1 day
          const lastDate = new Date(lastPoint.Date);
          const nextDateObj = new Date(lastDate.getTime() + 24 * 60 * 60 * 1000);
          const year = nextDateObj.getFullYear();
          const month = String(nextDateObj.getMonth() + 1).padStart(2, '0');
          const day = String(nextDateObj.getDate()).padStart(2, '0');
          const nextDateStr = `${year}-${month}-${day}`;

          return [
            ...prevSeries,
            { Date: nextDateStr, Close: parseFloat(nextPrice.toFixed(2)) }
          ];
        });
      }, 1500); // 1.5 second tick interval
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isLiveFeedActive, chartSeries.length]);

  // Quant Engine Computations
  const results = useMemo(() => {
    if (chartSeries.length < 10) return null;

    const splitIndex = Math.floor((chartSeries.length - 1) * (trainingRatio / 100));

    const discretizeConfig = {
      sdMultiplier,
      percentThreshold,
      usePercentThreshold,
      fastPeriod,
      slowPeriod,
      volPeriod,
      trainingRatio
    };
    
    const { states, stateNames } = discretizeStates(chartSeries, modelType, discretizeConfig);
    const M = stateNames.length;

    if (states.length < 5) return null;

    // Transition matrix trained STRICTLY on In-Sample (IS) states
    const { counts, matrix } = calculateTransitions(states, M, splitIndex);
    const steadyState = calculateSteadyState(matrix);
    const recurrenceTimes = steadyState.map(p => (p > 0 ? 1 / p : Infinity));
    const mfpt = calculateMFPT(matrix);
    const markovTest = performMarkovPropertyTest(counts);

    const backtestConfig = {
      transactionCost,
      strategyType,
      signalMethod,
      buyReturnThreshold,
      sellReturnThreshold,
      buyProbThreshold,
      sellProbThreshold,
      riskFreeRate,
      trainingRatio,
      includeWeekends: selectedAsset === 'BTC'
    };
    
    const backtest = backtestMarkovStrategy(states, matrix, modelType, backtestConfig);
    const simulation = simulateMCMC(chartSeries, states, matrix, mcmcPaths, mcmcHorizon);

    return {
      states,
      stateNames,
      counts,
      matrix,
      steadyState,
      recurrenceTimes,
      mfpt,
      markovTest,
      backtest,
      simulation,
      assetLength: chartSeries.length,
      splitIndex
    };
  }, [
    chartSeries,
    modelType,
    trainingRatio,
    sdMultiplier,
    percentThreshold,
    usePercentThreshold,
    fastPeriod,
    slowPeriod,
    volPeriod,
    transactionCost,
    strategyType,
    signalMethod,
    buyReturnThreshold,
    sellReturnThreshold,
    buyProbThreshold,
    sellProbThreshold,
    riskFreeRate,
    selectedAsset,
    mcmcPaths,
    mcmcHorizon,
    mcmcTriggerSeed
  ]);

  // Handle CSV file uploads
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadedFilename(file.name);
    setUploadError('');

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target.result;
        const lines = text.split(/\r?\n/);
        
        if (lines.length < 2) {
          throw new Error('CSV file structure requires headers and pricing rows.');
        }

        const header = lines[0].split(',').map(h => h.trim().toLowerCase());
        const dateIdx = header.findIndex(h => h.includes('date') || h.includes('time') || h.includes('timestamp'));
        const closeIdx = header.findIndex(h => h.includes('close') || h.includes('price') || h.includes('value'));

        if (dateIdx === -1) throw new Error('Column header "Date" or "Time" was not found.');
        if (closeIdx === -1) throw new Error('Column header "Close" or "Price" was not found.');

        const data = [];
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          
          const cols = lines[i].split(',');
          const dateVal = cols[dateIdx]?.trim();
          const closeVal = parseFloat(cols[closeIdx]?.trim());

          if (dateVal && !isNaN(closeVal)) {
            data.push({
              Date: dateVal,
              Close: closeVal
            });
          }
        }

        if (data.length < 20) {
          throw new Error(`Insufficient pricing rows (parsed ${data.length}). Require minimum 20 rows.`);
        }

        data.sort((a, b) => new Date(a.Date) - new Date(b.Date));

        setUploadedData(data);
        setSelectedAsset('UPLOADED');
        setActiveTab('markov');
      } catch (err) {
        setUploadError(err.message);
        setUploadedFilename('');
        setUploadedData(null);
      }
    };
    reader.readAsText(file);
  };

  const triggerFileSelect = () => {
    fileInputRef.current.click();
  };

  const triggerSimulation = () => {
    setMcmcTriggerSeed(prev => prev + 1);
  };

  const formatPct = (val) => `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
  const formatNumber = (val) => val.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const currentStateDetails = useMemo(() => {
    if (!results || results.states.length === 0) return null;
    const lastItem = results.states[results.states.length - 1];
    return {
      stateId: lastItem.State,
      stateName: results.stateNames[lastItem.State],
      date: lastItem.Date,
      price: lastItem.Price,
      ret: lastItem.Return
    };
  }, [results]);

  const nextStatePrediction = useMemo(() => {
    if (!results || !currentStateDetails) return null;
    const row = results.matrix[currentStateDetails.stateId];
    let maxProb = -1;
    let predictedId = 0;
    
    row.forEach((prob, idx) => {
      if (prob > maxProb) {
        maxProb = prob;
        predictedId = idx;
      }
    });

    return {
      stateName: results.stateNames[predictedId],
      prob: maxProb
    };
  }, [results, currentStateDetails]);

  // Chart datasets
  const backtestChartData = useMemo(() => {
    if (!results || !results.backtest) return { labels: [], datasets: [] };
    
    const timeline = results.backtest.timeline;
    const stride = Math.max(1, Math.floor(timeline.length / 500));
    
    const sampledData = [];
    for (let i = 0; i < timeline.length; i += stride) {
      sampledData.push(timeline[i]);
    }
    if (sampledData[sampledData.length - 1]?.Date !== timeline[timeline.length - 1].Date) {
      sampledData.push(timeline[timeline.length - 1]);
    }

    return {
      labels: sampledData.map(d => d.Date),
      datasets: [
        {
          label: 'Markov Chain Strategy',
          data: sampledData.map(d => d.StratCumReturn),
          borderColor: '#00f0ff',
          backgroundColor: 'rgba(0, 240, 255, 0.03)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.1
        },
        {
          label: 'Buy & Hold (Benchmark)',
          data: sampledData.map(d => d.BenchCumReturn),
          borderColor: 'rgba(156, 163, 175, 0.5)',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderDash: [4, 4],
          fill: false,
          tension: 0.1
        }
      ]
    };
  }, [results]);

  // Custom ChartJS Plugin to draw dashed vertical boundary for Train/Test split
  const verticalLinePlugin = useMemo(() => {
    if (!results || trainingRatio >= 100) return null;
    
    const splitIndex = results.splitIndex;
    const timeline = results.backtest.timeline;
    const splitDate = timeline[splitIndex]?.Date;
    
    return {
      id: 'verticalLine',
      afterDraw: (chart) => {
        if (chart.scales.x && splitDate) {
          const xScales = chart.scales.x;
          const index = chart.data.labels.indexOf(splitDate);
          if (index !== -1) {
            const x = xScales.getPixelForValue(splitDate);
            const ctx = chart.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([6, 6]);
            ctx.moveTo(x, chart.chartArea.top);
            ctx.lineTo(x, chart.chartArea.bottom);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#8b5cf6'; // Violet boundary color
            ctx.stroke();
            
            // Labels
            ctx.fillStyle = '#8b5cf6';
            ctx.font = '9px var(--font-heading)';
            ctx.textAlign = 'right';
            ctx.fillText('In-Sample (Train)', x - 8, chart.chartArea.top + 16);
            ctx.textAlign = 'left';
            ctx.fillText('Out-of-Sample (Test)', x + 8, chart.chartArea.top + 16);
            ctx.restore();
          }
        }
      }
    };
  }, [results, trainingRatio]);

  const mcmcChartData = useMemo(() => {
    if (!results || !results.simulation) return { labels: [], datasets: [] };
    
    const sim = results.simulation;
    const steps = sim.percentiles.map(d => `Day ${d.Step}`);
    
    const datasets = [
      {
        label: 'Median Path (50th)',
        data: sim.percentiles.map(d => d.p50),
        borderColor: '#00f0ff',
        backgroundColor: 'rgba(0, 240, 255, 0.1)',
        borderWidth: 2.5,
        pointRadius: 0,
        fill: false,
        zIndex: 5
      },
      {
        label: '25th-75th Percentile Range',
        data: sim.percentiles.map(d => d.p75),
        borderColor: 'rgba(139, 92, 246, 0.4)',
        backgroundColor: 'rgba(139, 92, 246, 0.08)',
        borderWidth: 1,
        pointRadius: 0,
        fill: '+1', 
        tension: 0.1
      },
      {
        label: 'p25_lower',
        data: sim.percentiles.map(d => d.p25),
        borderColor: 'rgba(139, 92, 246, 0.4)',
        backgroundColor: 'transparent',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0.1,
        legend: { display: false }
      },
      {
        label: '10th-90th Percentile Range',
        data: sim.percentiles.map(d => d.p90),
        borderColor: 'rgba(245, 158, 11, 0.3)',
        backgroundColor: 'rgba(245, 158, 11, 0.04)',
        borderWidth: 1,
        pointRadius: 0,
        fill: '+1', 
        tension: 0.1
      },
      {
        label: 'p10_lower',
        data: sim.percentiles.map(d => d.p10),
        borderColor: 'rgba(245, 158, 11, 0.3)',
        backgroundColor: 'transparent',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        tension: 0.1
      }
    ];

    sim.samplePaths.slice(0, 3).forEach((path, idx) => {
      const colors = ['rgba(244, 63, 94, 0.55)', 'rgba(16, 185, 129, 0.55)', 'rgba(6, 182, 212, 0.55)'];
      datasets.push({
        label: `Sample Path ${idx + 1}`,
        data: path,
        borderColor: colors[idx],
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        borderDash: [2, 2]
      });
    });

    return {
      labels: steps,
      datasets
    };
  }, [results]);

  const steadyStateChartData = useMemo(() => {
    if (!results) return { labels: [], datasets: [] };
    const colors = ['#f43f5e', '#f59e0b', '#10b981', '#8b5cf6'];
    
    return {
      labels: results.stateNames,
      datasets: [
        {
          label: 'Steady State Probability',
          data: results.steadyState.map(p => parseFloat((p * 100).toFixed(2))),
          backgroundColor: results.stateNames.map((_, i) => results.stateNames.length === 3 && i === 2 ? colors[2] : colors[i % colors.length]),
          borderColor: 'rgba(255, 255, 255, 0.15)',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [results]);

  const defaultChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: '#9ca3af', font: { family: 'var(--font-heading)' } }
      },
      tooltip: {
        backgroundColor: '#0c101b',
        titleColor: '#00f0ff',
        bodyColor: '#fff',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        titleFont: { family: 'var(--font-heading)' }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255, 255, 255, 0.03)' },
        ticks: { color: '#9ca3af', font: { size: 10 } }
      },
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.03)' },
        ticks: { color: '#9ca3af', font: { size: 10 } }
      }
    }
  };

  const backtestChartOptions = {
    ...defaultChartOptions,
    plugins: {
      ...defaultChartOptions.plugins,
      tooltip: {
        ...defaultChartOptions.plugins.tooltip,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%`
        }
      }
    },
    scales: {
      ...defaultChartOptions.scales,
      y: {
        ...defaultChartOptions.scales.y,
        ticks: {
          ...defaultChartOptions.scales.y.ticks,
          callback: (value) => `${value}%`
        }
      }
    }
  };

  const mcmcChartOptions = {
    ...defaultChartOptions,
    plugins: {
      ...defaultChartOptions.plugins,
      legend: {
        labels: {
          filter: (legendItem) => !legendItem.text.includes('p25_lower') && !legendItem.text.includes('p10_lower')
        }
      }
    }
  };

  return (
    <div className="dashboard-container">
      {/* HEADER SECTION */}
      <header className="dashboard-header">
        <div className="brand-section">
          <div className="brand-logo">
            <Activity size={32} strokeWidth={2.5} />
          </div>
          <div className="brand-title">
            <h1>Markov Chain Dashboard</h1>
            <p>Quantitative Financial Regime Modeling & HMM EM Backtester</p>
          </div>
        </div>

        <div className="header-controls">
          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            ref={fileInputRef}
          />
          <button className="btn-secondary" onClick={triggerFileSelect}>
            <Upload size={15} />
            <span>Upload CSV</span>
          </button>

          {/* Real-time Streaming Feed Switch */}
          <button
            className="btn-secondary"
            onClick={() => setIsLiveFeedActive(prev => !prev)}
            style={{
              borderColor: isLiveFeedActive ? 'var(--clr-emerald)' : 'var(--border-color)',
              color: isLiveFeedActive ? 'var(--clr-emerald)' : 'var(--text-main)',
              boxShadow: isLiveFeedActive ? '0 0 10px rgba(16, 185, 129, 0.2)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: isLiveFeedActive ? 'var(--clr-emerald)' : 'rgba(156, 163, 175, 0.4)',
              display: 'inline-block',
              animation: isLiveFeedActive ? 'pulse 1.5s infinite' : 'none'
            }} />
            <span>{isLiveFeedActive ? 'Feed Active' : 'Live Stream'}</span>
          </button>
          
          <select
            className="control-input"
            value={selectedAsset}
            onChange={(e) => setSelectedAsset(e.target.value)}
            style={{ minWidth: '150px' }}
          >
            <optgroup label="US & Global Markets">
              <option value="SPY">S&P 500 (SPY)</option>
              <option value="QQQ">Nasdaq 100 (QQQ)</option>
              <option value="BTC">Bitcoin (BTC)</option>
              <option value="GLD">Gold (GLD)</option>
            </optgroup>
            <optgroup label="Indian Markets">
              <option value="NIFTY50">Nifty 50 (NIFTY)</option>
              <option value="SENSEX">BSE Sensex (SENSEX)</option>
              <option value="RELIANCE">Reliance Industries (RELIANCE)</option>
              <option value="TCS">Tata Consultancy Services (TCS)</option>
            </optgroup>
            {uploadedData && (
              <optgroup label="Uploaded Data">
                <option value="UPLOADED">File: {uploadedFilename.substring(0, 12)}...</option>
              </optgroup>
            )}
          </select>
        </div>
      </header>

      {/* ERROR MESSAGE BAR */}
      {uploadError && (
        <div style={{
          background: 'rgba(244, 63, 94, 0.15)',
          color: '#f43f5e',
          padding: '1rem',
          borderRadius: '8px',
          border: '1px solid rgba(244, 63, 94, 0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.85rem'
        }}>
          <AlertCircle size={18} />
          <span>Error parsing CSV: {uploadError}</span>
        </div>
      )}

      {/* PARAMETERS CONFIG PANEL */}
      <section className="control-grid">
        <div className="control-item">
          <label>State Discretization Model</label>
          <select
            className="control-input"
            value={modelType}
            onChange={(e) => setModelType(e.target.value)}
          >
            <option value="UNSUPERVISED_HMM">Unsupervised Hidden Markov Model (HMM)</option>
            <option value="RETURN_THRESHOLD">Return Standard Deviation Threshold</option>
            <option value="MA_CROSSOVER">Double Moving Average Crossover</option>
            <option value="VOLATILITY_REGIME">Volatility Regime (4-State)</option>
          </select>
        </div>

        {/* Train/Test split ratio slider */}
        <div className="control-item">
          <label>Training Split: {trainingRatio}% IS / {100 - trainingRatio}% OOS</label>
          <input
            type="range"
            min="50"
            max="100"
            step="5"
            value={trainingRatio}
            onChange={(e) => setTrainingRatio(parseInt(e.target.value))}
            className="slider"
          />
        </div>

        {modelType === 'RETURN_THRESHOLD' && (
          <>
            <div className="control-item">
              <label>Threshold Source</label>
              <div className="control-input-group">
                <span 
                  onClick={() => setUsePercentThreshold(false)} 
                  className={`switch-container ${!usePercentThreshold ? 'active' : ''}`}
                >
                  <div className="switch-track"><div className="switch-thumb"></div></div>
                  <span style={{ fontSize: '0.75rem' }}>Std Dev</span>
                </span>
                <span 
                  onClick={() => setUsePercentThreshold(true)} 
                  className={`switch-container ${usePercentThreshold ? 'active' : ''}`}
                >
                  <div className="switch-track"><div className="switch-thumb"></div></div>
                  <span style={{ fontSize: '0.75rem' }}>Percent</span>
                </span>
              </div>
            </div>
            {usePercentThreshold ? (
              <div className="control-item">
                <label>Daily Threshold: {percentThreshold}%</label>
                <input
                  type="range"
                  min="0.1"
                  max="2.5"
                  step="0.1"
                  value={percentThreshold}
                  onChange={(e) => setPercentThreshold(parseFloat(e.target.value))}
                  className="slider"
                />
              </div>
            ) : (
              <div className="control-item">
                <label>SD Multiplier: {sdMultiplier}x SD</label>
                <input
                  type="range"
                  min="0.1"
                  max="2.0"
                  step="0.05"
                  value={sdMultiplier}
                  onChange={(e) => setSdMultiplier(parseFloat(e.target.value))}
                  className="slider"
                />
              </div>
            )}
          </>
        )}

        {modelType === 'MA_CROSSOVER' && (
          <>
            <div className="control-item">
              <label>Fast SMA: {fastPeriod} Days</label>
              <input
                type="range"
                min="5"
                max="30"
                step="1"
                value={fastPeriod}
                onChange={(e) => setFastPeriod(parseInt(e.target.value))}
                className="slider"
              />
            </div>
            <div className="control-item">
              <label>Slow SMA: {slowPeriod} Days</label>
              <input
                type="range"
                min="35"
                max="100"
                step="5"
                value={slowPeriod}
                onChange={(e) => setSlowPeriod(parseInt(e.target.value))}
                className="slider"
              />
            </div>
          </>
        )}

        {modelType === 'VOLATILITY_REGIME' && (
          <div className="control-item">
            <label>Vol Period: {volPeriod} Days</label>
            <input
              type="range"
              min="5"
              max="50"
              step="1"
              value={volPeriod}
              onChange={(e) => setVolPeriod(parseInt(e.target.value))}
              className="slider"
            />
          </div>
        )}

        <div className="control-item" style={{ borderLeft: '1px solid rgba(255,255,255,0.05)', paddingLeft: '1.25rem' }}>
          <label>Backtest Signal Logic</label>
          <select
            className="control-input"
            value={signalMethod}
            onChange={(e) => setSignalMethod(e.target.value)}
          >
            <option value="EXPECTED_RETURN_MOMENTUM">Expected Return (Regime Momentum)</option>
            <option value="PROBABILITY_THRESHOLD">Direct Probability Threshold</option>
          </select>
        </div>

        <div className="control-item">
          <label>Exposure Type</label>
          <select
            className="control-input"
            value={strategyType}
            onChange={(e) => setStrategyType(e.target.value)}
          >
            <option value="LONG_ONLY">Long / Cash (0% vs 100%)</option>
            <option value="LONG_SHORT">Long / Short (-100% vs 100%)</option>
          </select>
        </div>
      </section>

      {/* KPI METRIC CARDS */}
      {results && currentStateDetails && (
        <section className="kpi-grid">
          <MetricCard
            label="Current Regime State"
            value={currentStateDetails.stateName}
            subtext={`As of ${currentStateDetails.date} (Price: ${formatNumber(currentStateDetails.price)})`}
            icon={Activity}
            color={
              results.stateNames.length === 3 
                ? (currentStateDetails.stateId === 2 ? 'emerald' : currentStateDetails.stateId === 0 ? 'rose' : 'amber')
                : (currentStateDetails.stateId >= 2 ? 'emerald' : 'rose')
            }
          />
          <MetricCard
            label="Next State Prediction"
            value={nextStatePrediction?.stateName || 'N/A'}
            subtext={`Highest transition probability: ${(nextStatePrediction?.prob * 100 || 0).toFixed(1)}%`}
            icon={Play}
            color="cyan"
          />
          <MetricCard
            label="Markov Property p-Value"
            value={results.markovTest.pValue.toFixed(5)}
            subtext={results.markovTest.significant ? 'Significant Markov Structure' : 'Random Walk (Non-Markovian)'}
            icon={Percent}
            color={results.markovTest.significant ? 'emerald' : 'amber'}
          />
          {/* Sharpe Card shows Out-of-Sample metrics if split is enabled */}
          <MetricCard
            label={trainingRatio < 100 ? "Sharpe Ratio (Test Period OOS)" : "Sharpe Ratio (Overall)"}
            value={
              trainingRatio < 100
                ? `${results.backtest?.metrics.outOfSample.strat.sharpe.toFixed(2)} / ${results.backtest?.metrics.outOfSample.bench.sharpe.toFixed(2)}`
                : `${results.backtest?.metrics.overall.strat.sharpe.toFixed(2)} / ${results.backtest?.metrics.overall.bench.sharpe.toFixed(2)}`
            }
            subtext={
              trainingRatio < 100
                ? `Test Return: ${formatPct(results.backtest?.metrics.outOfSample.strat.totalReturn || 0)}`
                : `Total Return: ${formatPct(results.backtest?.metrics.overall.strat.totalReturn || 0)}`
            }
            icon={TrendingUp}
            trend={
              trainingRatio < 100
                ? (results.backtest?.metrics.outOfSample.strat.sharpe > results.backtest?.metrics.outOfSample.bench.sharpe ? 'up' : 'down')
                : (results.backtest?.metrics.overall.strat.sharpe > results.backtest?.metrics.overall.bench.sharpe ? 'up' : 'down')
            }
            color={
              trainingRatio < 100
                ? (results.backtest?.metrics.outOfSample.strat.sharpe > results.backtest?.metrics.outOfSample.bench.sharpe ? 'emerald' : 'rose')
                : (results.backtest?.metrics.overall.strat.sharpe > results.backtest?.metrics.overall.bench.sharpe ? 'emerald' : 'rose')
            }
          />
        </section>
      )}

      {/* WORKSPACE AREA (TABS) */}
      <section className="panel-card" style={{ gap: '0px', padding: '0px' }}>
        <div className="tabs-header-container" style={{ padding: '0.5rem 1.5rem 0rem 1.5rem' }}>
          <nav className="tabs-navigation">
            <button
              className={`btn-tab ${activeTab === 'markov' ? 'active' : ''}`}
              onClick={() => setActiveTab('markov')}
            >
              <BarChart2 size={14} style={{ marginRight: '6px' }} />
              Markov Analytics
            </button>
            <button
              className={`btn-tab ${activeTab === 'backtest' ? 'active' : ''}`}
              onClick={() => setActiveTab('backtest')}
            >
              <TrendingUp size={14} style={{ marginRight: '6px' }} />
              Trading Backtester
            </button>
            <button
              className={`btn-tab ${activeTab === 'mcmc' ? 'active' : ''}`}
              onClick={() => setActiveTab('mcmc')}
            >
              <Maximize2 size={14} style={{ marginRight: '6px' }} />
              MCMC Simulator
            </button>
            <button
              className={`btn-tab ${activeTab === 'explorer' ? 'active' : ''}`}
              onClick={() => setActiveTab('explorer')}
            >
              <Calendar size={14} style={{ marginRight: '6px' }} />
              Data Explorer
            </button>
          </nav>
          
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            Analyzed {results?.assetLength} daily data points
          </div>
        </div>

        <div className="tab-content" style={{ padding: '1.5rem' }}>
          {results ? (
            <>
              {/* TAB 1: MARKOV ANALYTICS */}
              {activeTab === 'markov' && (
                <div className="grid-2col">
                  {/* Left Column: Heatmap & Tables */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div className="panel-card" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                      <div className="panel-title">
                        Transition Probability Matrix (TPM)
                        <span className="title-desc">Estimated strictly on the In-Sample (IS) training period</span>
                      </div>
                      
                      <div className="heatmap-container">
                        {/* Column labels */}
                        <div className="heatmap-label-row" style={{ gridTemplateColumns: `80px repeat(${results.stateNames.length}, 1fr)` }}>
                          <div></div>
                          {results.stateNames.map((name, idx) => (
                            <div key={`col-${idx}`} style={{ textOverflow: 'ellipsis', overflow: 'hidden' }}>{name}</div>
                          ))}
                        </div>

                        {/* Rows */}
                        {results.matrix.map((row, rowIdx) => (
                          <div
                            key={`row-${rowIdx}`}
                            className="heatmap-row"
                            style={{ gridTemplateColumns: `80px repeat(${results.stateNames.length}, 1fr)` }}
                          >
                            <div className="heatmap-row-label">{results.stateNames[rowIdx]}</div>
                            {row.map((prob, colIdx) => {
                              const alpha = 0.08 + prob * 0.72;
                              const textColor = prob > 0.45 ? '#0c101b' : '#fff';
                              return (
                                <div
                                  key={`cell-${rowIdx}-${colIdx}`}
                                  className="heatmap-cell"
                                  style={{
                                    backgroundColor: `rgba(0, 240, 255, ${alpha})`,
                                    color: textColor,
                                    border: `1px solid rgba(0, 240, 255, ${prob * 0.3})`
                                  }}
                                >
                                  <span className="cell-value">{(prob * 100).toFixed(1)}%</span>
                                  <span className="cell-sub">{results.counts[rowIdx][colIdx]} transitions</span>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="panel-card" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                      <div className="panel-title">
                        Steady State & Expected Recurrence (In-Sample)
                      </div>
                      <div className="quant-table-wrapper">
                        <table className="quant-table">
                          <thead>
                            <tr>
                              <th>State Name</th>
                              <th>Steady State Prob.</th>
                              <th>Mean Recurrence Time</th>
                              <th>Mean Historical Daily Return</th>
                            </tr>
                          </thead>
                          <tbody>
                            {results.stateNames.map((name, idx) => (
                              <tr key={`stats-${idx}`}>
                                <td style={{ fontWeight: '600' }}>{name}</td>
                                <td>{(results.steadyState[idx] * 100).toFixed(2)}%</td>
                                <td>{results.recurrenceTimes[idx].toFixed(1)} days</td>
                                <td className={results.backtest.meanStateReturns[idx] >= 0 ? 'text-green' : 'text-red'}>
                                  {results.backtest.meanStateReturns[idx].toFixed(4)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Node Diagram */}
                  <div className="panel-card" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                    <div className="panel-title">
                      State Transition Diagram
                      <span className="title-desc">Dynamic node-link model</span>
                    </div>
                    <StateDiagram matrix={results.matrix} stateNames={results.stateNames} />
                  </div>
                </div>
              )}

              {/* TAB 2: TRADING BACKTESTER */}
              {activeTab === 'backtest' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {/* Backtest Config Inputs */}
                  <div className="control-grid" style={{ padding: '1rem 1.25rem', background: 'var(--bg-input)' }}>
                    <div className="control-item">
                      <label style={{ fontSize: '0.65rem' }}>Tx Cost: {transactionCost}%</label>
                      <input
                        type="range"
                        min="0.00"
                        max="0.50"
                        step="0.01"
                        value={transactionCost}
                        onChange={(e) => setTransactionCost(parseFloat(e.target.value))}
                        className="slider"
                      />
                    </div>
                    {signalMethod === 'EXPECTED_RETURN_MOMENTUM' ? (
                      <>
                        <div className="control-item">
                          <label style={{ fontSize: '0.65rem' }}>Buy Threshold: {buyReturnThreshold} bps</label>
                          <input
                            type="range"
                            min="0"
                            max="15"
                            step="0.5"
                            value={buyReturnThreshold}
                            onChange={(e) => setBuyReturnThreshold(parseFloat(e.target.value))}
                            className="slider"
                          />
                        </div>
                        <div className="control-item">
                          <label style={{ fontSize: '0.65rem' }}>Sell Threshold: {sellReturnThreshold} bps</label>
                          <input
                            type="range"
                            min="-15"
                            max="0"
                            step="0.5"
                            value={sellReturnThreshold}
                            onChange={(e) => setSellReturnThreshold(parseFloat(e.target.value))}
                            className="slider"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="control-item">
                          <label style={{ fontSize: '0.65rem' }}>Buy Prob: {buyProbThreshold}%</label>
                          <input
                            type="range"
                            min="30"
                            max="60"
                            step="1"
                            value={buyProbThreshold}
                            onChange={(e) => setBuyProbThreshold(parseInt(e.target.value))}
                            className="slider"
                          />
                        </div>
                        <div className="control-item">
                          <label style={{ fontSize: '0.65rem' }}>Sell Prob: {sellProbThreshold}%</label>
                          <input
                            type="range"
                            min="30"
                            max="60"
                            step="1"
                            value={sellProbThreshold}
                            onChange={(e) => setSellProbThreshold(parseInt(e.target.value))}
                            className="slider"
                          />
                        </div>
                      </>
                    )}
                    <div className="control-item">
                      <label style={{ fontSize: '0.65rem' }}>Risk-Free Rate: {riskFreeRate}%</label>
                      <input
                        type="range"
                        min="0.0"
                        max="8.0"
                        step="0.1"
                        value={riskFreeRate}
                        onChange={(e) => setRiskFreeRate(parseFloat(e.target.value))}
                        className="slider"
                      />
                    </div>
                  </div>

                  {/* Chart and Metrics table side by side */}
                  <div className="grid-2col" style={{ gridTemplateColumns: '2fr 1fr' }}>
                    {/* Chart with vertical partition line */}
                    <div className="panel-card">
                      <div className="panel-title">Equity Growth Comparison</div>
                      <div className="chart-container">
                        <Line 
                          data={backtestChartData} 
                          options={backtestChartOptions} 
                          plugins={verticalLinePlugin ? [verticalLinePlugin] : []}
                        />
                      </div>
                    </div>
                    
                    {/* Performance Table (Upgraded with In-Sample / Out-of-Sample segments) */}
                    <div className="panel-card">
                      <div className="panel-title">Performance Validation</div>
                      
                      <div className="quant-table-wrapper" style={{ marginTop: '0.5rem' }}>
                        <table className="quant-table" style={{ fontSize: '0.78rem' }}>
                          <thead>
                            <tr>
                              <th rowSpan="2" style={{ verticalAlign: 'middle' }}>Metric</th>
                              <th colSpan="2" style={{ textAlign: 'center' }}>In-Sample (Train)</th>
                              <th colSpan="2" style={{ textAlign: 'center' }}>Out-of-Sample (Test)</th>
                            </tr>
                            <tr>
                              <th style={{ fontSize: '0.65rem', borderBottom: '1px solid var(--border-color)', textAlign: 'center' }}>Strat</th>
                              <th style={{ fontSize: '0.65rem', borderBottom: '1px solid var(--border-color)', textAlign: 'center' }}>B&H</th>
                              <th style={{ fontSize: '0.65rem', borderBottom: '1px solid var(--border-color)', textAlign: 'center' }}>Strat</th>
                              <th style={{ fontSize: '0.65rem', borderBottom: '1px solid var(--border-color)', textAlign: 'center' }}>B&H</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td style={{ fontWeight: '600' }}>Total Return</td>
                              <td className={results.backtest.metrics.inSample.strat.totalReturn >= 0 ? 'text-green' : 'text-red'}>
                                {formatPct(results.backtest.metrics.inSample.strat.totalReturn)}
                              </td>
                              <td className={results.backtest.metrics.inSample.bench.totalReturn >= 0 ? 'text-green' : 'text-red'}>
                                {formatPct(results.backtest.metrics.inSample.bench.totalReturn)}
                              </td>
                              <td className={results.backtest.metrics.outOfSample.strat.totalReturn >= 0 ? 'text-green' : 'text-red'} style={{ fontWeight: '700', borderLeft: '1px solid rgba(255,255,255,0.03)' }}>
                                {formatPct(results.backtest.metrics.outOfSample.strat.totalReturn)}
                              </td>
                              <td className={results.backtest.metrics.outOfSample.bench.totalReturn >= 0 ? 'text-green' : 'text-red'}>
                                {formatPct(results.backtest.metrics.outOfSample.bench.totalReturn)}
                              </td>
                            </tr>
                            <tr>
                              <td style={{ fontWeight: '600' }}>Annualized Return</td>
                              <td className={results.backtest.metrics.inSample.strat.annReturn >= 0 ? 'text-green' : 'text-red'}>
                                {formatPct(results.backtest.metrics.inSample.strat.annReturn)}
                              </td>
                              <td className={results.backtest.metrics.inSample.bench.annReturn >= 0 ? 'text-green' : 'text-red'}>
                                {formatPct(results.backtest.metrics.inSample.bench.annReturn)}
                              </td>
                              <td className={results.backtest.metrics.outOfSample.strat.annReturn >= 0 ? 'text-green' : 'text-red'} style={{ fontWeight: '700', borderLeft: '1px solid rgba(255,255,255,0.03)' }}>
                                {formatPct(results.backtest.metrics.outOfSample.strat.annReturn)}
                              </td>
                              <td className={results.backtest.metrics.outOfSample.bench.annReturn >= 0 ? 'text-green' : 'text-red'}>
                                {formatPct(results.backtest.metrics.outOfSample.bench.annReturn)}
                              </td>
                            </tr>
                            <tr>
                              <td style={{ fontWeight: '600' }}>Volatility (Ann.)</td>
                              <td>{results.backtest.metrics.inSample.strat.volatility.toFixed(1)}%</td>
                              <td>{results.backtest.metrics.inSample.bench.volatility.toFixed(1)}%</td>
                              <td style={{ borderLeft: '1px solid rgba(255,255,255,0.03)' }}>{results.backtest.metrics.outOfSample.strat.volatility.toFixed(1)}%</td>
                              <td>{results.backtest.metrics.outOfSample.bench.volatility.toFixed(1)}%</td>
                            </tr>
                            <tr>
                              <td style={{ fontWeight: '600' }}>Sharpe Ratio</td>
                              <td className="text-cyan">{results.backtest.metrics.inSample.strat.sharpe.toFixed(2)}</td>
                              <td>{results.backtest.metrics.inSample.bench.sharpe.toFixed(2)}</td>
                              <td className="text-cyan" style={{ fontWeight: '700', borderLeft: '1px solid rgba(255,255,255,0.03)' }}>
                                {results.backtest.metrics.outOfSample.strat.sharpe.toFixed(2)}
                              </td>
                              <td>{results.backtest.metrics.outOfSample.bench.sharpe.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td style={{ fontWeight: '600' }}>Max Drawdown</td>
                              <td className="text-red">-{results.backtest.metrics.inSample.strat.maxDrawdown.toFixed(1)}%</td>
                              <td className="text-red">-{results.backtest.metrics.inSample.bench.maxDrawdown.toFixed(1)}%</td>
                              <td className="text-red" style={{ borderLeft: '1px solid rgba(255,255,255,0.03)' }}>-{results.backtest.metrics.outOfSample.strat.maxDrawdown.toFixed(1)}%</td>
                              <td className="text-red">-{results.backtest.metrics.outOfSample.bench.maxDrawdown.toFixed(1)}%</td>
                            </tr>
                            <tr>
                              <td style={{ fontWeight: '600' }}>Trades Count</td>
                              <td colSpan="2" style={{ textAlign: 'center' }}>{results.backtest.metrics.inSample.tradesCount} trades</td>
                              <td colSpan="2" style={{ textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.03)' }}>{results.backtest.metrics.outOfSample.tradesCount} trades</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      
                      <div 
                        style={{
                          background: 'rgba(255,255,255,0.01)',
                          padding: '0.65rem 0.85rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          fontSize: '0.72rem',
                          color: 'var(--text-muted)',
                          marginTop: '0.5rem'
                        }}
                      >
                        <div>Total backtest length: <strong>{results.backtest.metrics.totalDays}</strong> days</div>
                        <div>Out-of-Sample testing length: <strong>{results.backtest.metrics.totalDays - results.splitIndex}</strong> days</div>
                      </div>
                    </div>
                  </div>

                  {/* MFPT Matrix */}
                  <div className="panel-card">
                    <div className="panel-title">
                      Mean First Passage Time (MFPT) Matrix
                      <span className="title-desc">Expected number of steps (days) to transition from State i (Row) to State j (Col) for the first time</span>
                    </div>
                    <div className="quant-table-wrapper">
                      <table className="quant-table">
                        <thead>
                          <tr>
                            <th>From State</th>
                            {results.stateNames.map((name, idx) => (
                              <th key={`mfpt-h-${idx}`}>{name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {results.mfpt.map((row, rowIdx) => (
                            <tr key={`mfpt-r-${rowIdx}`}>
                              <td style={{ fontWeight: '600' }}>{results.stateNames[rowIdx]}</td>
                              {row.map((val, colIdx) => (
                                <td key={`mfpt-val-${rowIdx}-${colIdx}`} style={{ fontFamily: 'monospace' }}>
                                  {rowIdx === colIdx ? (
                                    <span className="text-muted">0.0 (Self)</span>
                                  ) : (
                                    <span>{val.toFixed(1)} days</span>
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: MCMC SIMULATION */}
              {activeTab === 'mcmc' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {/* Simulation Controls */}
                  <div className="control-grid" style={{ padding: '1rem 1.25rem', background: 'var(--bg-input)' }}>
                    <div className="control-item">
                      <label style={{ fontSize: '0.65rem' }}>Simulation Paths: {mcmcPaths}</label>
                      <input
                        type="range"
                        min="50"
                        max="500"
                        step="25"
                        value={mcmcPaths}
                        onChange={(e) => setMcmcPaths(parseInt(e.target.value))}
                        className="slider"
                      />
                    </div>
                    <div className="control-item">
                      <label style={{ fontSize: '0.65rem' }}>Horizon (Trading Days): {mcmcHorizon}</label>
                      <input
                        type="range"
                        min="10"
                        max="200"
                        step="5"
                        value={mcmcHorizon}
                        onChange={(e) => setMcmcHorizon(parseInt(e.target.value))}
                        className="slider"
                      />
                    </div>
                    <div className="control-item" style={{ justifyContent: 'center' }}>
                      <button className="btn-primary" onClick={triggerSimulation}>
                        <RefreshCw size={14} />
                        <span>Run Simulation</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid-2col" style={{ gridTemplateColumns: '2fr 1fr' }}>
                    {/* Fan chart */}
                    <div className="panel-card">
                      <div className="panel-title">MCMC Future Price Projection (Fan Chart)</div>
                      <div className="chart-container">
                        <Line data={mcmcChartData} options={mcmcChartOptions} />
                      </div>
                    </div>
                    
                    {/* Projections stats */}
                    <div className="panel-card">
                      <div className="panel-title">Terminal Price Projections</div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Estimated terminal price values at the end of <strong>{mcmcHorizon}</strong> simulated steps, starting from the current price of <strong>{formatNumber(currentStateDetails.price)}</strong>.
                        </p>
                        
                        <div className="quant-table-wrapper">
                          <table className="quant-table">
                            <thead>
                              <tr>
                                <th>Percentile</th>
                                <th>Projected Price</th>
                                <th>Implied Return</th>
                              </tr>
                            </thead>
                            <tbody>
                              {['90', '75', '50', '25', '10'].map(p => {
                                const terminalVal = results.simulation.percentiles[results.simulation.percentiles.length - 1][`p${p}`];
                                const impliedRet = ((terminalVal - currentStateDetails.price) / currentStateDetails.price) * 100;
                                return (
                                  <tr key={`term-${p}`}>
                                    <td style={{ fontWeight: '600' }}>
                                      {p === '50' ? '50th (Median)' : `${p}th`}
                                    </td>
                                    <td style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                                      {formatNumber(terminalVal)}
                                    </td>
                                    <td className={impliedRet >= 0 ? 'text-green' : 'text-red'}>
                                      {formatPct(impliedRet)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        
                        <div style={{
                          background: 'rgba(0, 240, 255, 0.03)',
                          border: '1px dashed var(--clr-cyan)',
                          padding: '0.75rem',
                          borderRadius: '8px',
                          fontSize: '0.75rem',
                          color: 'var(--text-main)',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.5rem'
                        }}>
                          <Info size={16} className="text-cyan" style={{ flexShrink: 0 }} />
                          <span>
                            <strong>Methodology:</strong> We transition states sequentially based on the calculated transition matrix, then bootstrap returns by randomly sampling from historical pools associated with each state.
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: DATA EXPLORER */}
              {activeTab === 'explorer' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="grid-2col">
                    {/* Return distribution details */}
                    <div className="panel-card">
                      <div className="panel-title">Asset Return Distributions by State</div>
                      <div className="vol-dist-grid">
                        {results.stateNames.map((name, idx) => {
                          const stateRets = results.states.filter(s => s.State === idx).map(s => s.Return * 100);
                          const stateMean = calculateMean(stateRets);
                          const stateVol = calculateStdDev(stateRets, stateMean);
                          
                          const colors = ['#f43f5e', '#f59e0b', '#10b981', '#8b5cf6'];
                          const activeColor = results.stateNames.length === 3 && idx === 2 ? colors[2] : colors[idx % colors.length];

                          return (
                            <div className="vol-dist-card" key={`dist-${idx}`}>
                              <div className="vol-dist-header" style={{ color: activeColor }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: activeColor }} />
                                {name}
                              </div>
                              <div>
                                <span className="vol-dist-val" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Daily Mean Return:</span>
                                <div className={`vol-dist-val ${stateMean >= 0 ? 'text-green' : 'text-red'}`} style={{ fontSize: '1.15rem' }}>
                                  {stateMean.toFixed(4)}%
                                </div>
                              </div>
                              <div>
                                <span className="vol-dist-val" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Daily Volatility (Std Dev):</span>
                                <div className="vol-dist-val" style={{ fontSize: '1.15rem', color: '#fff' }}>
                                  {stateVol.toFixed(3)}%
                                </div>
                              </div>
                              <div>
                                <span className="vol-dist-val" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>State Freq (Days):</span>
                                <div className="vol-dist-val" style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>
                                  {stateRets.length} days ({((stateRets.length / results.states.length) * 100).toFixed(1)}%)
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Steady State probability chart */}
                    <div className="panel-card">
                      <div className="panel-title">Long-Term Stationary Distribution (Steady State)</div>
                      <div className="chart-container" style={{ height: '240px' }}>
                        <Bar
                          data={steadyStateChartData}
                          options={{
                            ...defaultChartOptions,
                            plugins: {
                              ...defaultChartOptions.plugins,
                              tooltip: {
                                ...defaultChartOptions.plugins.tooltip,
                                callbacks: { label: (ctx) => `${ctx.parsed.y}%` }
                              }
                            },
                            scales: {
                              ...defaultChartOptions.scales,
                              y: {
                                ...defaultChartOptions.scales.y,
                                ticks: { callback: (val) => `${val}%` }
                              }
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Historical State Table */}
                  <div className="panel-card">
                    <div className="panel-title">
                      Historical Price & Regime Log
                      <span className="title-desc">Showing latest 10 days of record history</span>
                    </div>
                    <div className="quant-table-wrapper">
                      <table className="quant-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Close Price</th>
                            <th>Daily Return</th>
                            <th>State Identifier</th>
                            <th>Strategy Position</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.states.slice(-10).reverse().map((record, idx) => {
                            const position = results.backtest.timeline[results.states.length - 1 - idx]?.Position ?? 0;
                            const posText = position === 1 ? 'Long (+1)' : position === -1 ? 'Short (-1)' : 'Cash (0)';
                            const posColor = position === 1 ? 'text-green' : position === -1 ? 'text-red' : 'text-muted';
                            
                            const colors = ['#f43f5e', '#f59e0b', '#10b981', '#8b5cf6'];
                            const stateIdx = record.State;
                            const stateColor = results.stateNames.length === 3 && stateIdx === 2 ? colors[2] : colors[stateIdx % colors.length];

                            return (
                              <tr key={`log-${idx}`}>
                                <td style={{ fontWeight: '600' }}>{record.Date}</td>
                                <td style={{ fontFamily: 'monospace' }}>{formatNumber(record.Price)}</td>
                                <td className={record.Return >= 0 ? 'text-green' : 'text-red'}>
                                  {(record.Return * 100).toFixed(4)}%
                                </td>
                                <td>
                                  <span style={{ 
                                    border: `1px solid ${stateColor}`, 
                                    color: stateColor, 
                                    padding: '0.15rem 0.4rem', 
                                    borderRadius: '4px',
                                    fontSize: '0.75rem',
                                    fontWeight: '600',
                                    background: `${stateColor}11`
                                  }}>
                                    {results.stateNames[stateIdx]}
                                  </span>
                                </td>
                                <td className={posColor} style={{ fontWeight: '600' }}>{posText}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              <AlertCircle size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.5 }} />
              <p>Insufficient price records to perform Markov calculations.</p>
              <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>Please select a preloaded asset or upload a daily stock price CSV with more data points.</p>
            </div>
          )}
        </div>
      </section>

      {/* FOOTER FOOTNOTES */}
      <footer className="dashboard-footer" style={{ textAlign: 'center', marginTop: '2rem', padding: '1rem', borderTop: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        <p>Markov Chain Dashboard System © 2026 GT Quant Labs. All mathematical analyses are executed client-side in real-time.</p>
        <p style={{ marginTop: '0.5rem', color: 'var(--text-dark)' }}>
          Disclaimer: Quantitative regime models are for research and educational purposes. Historical transition probabilities do not guarantee future market behavior.
        </p>
      </footer>
    </div>
  );
}
