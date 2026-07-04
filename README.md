# Hidden Markov Model & Markov Chain Quantitative Trading Dashboard

A premium, interactive web-based quantitative dashboard designed to partition financial assets into discrete market regimes (states), compute transition matrices, execute walk-forward backtests, and run Monte Carlo simulations. The system is written in React and features a high-performance custom math and statistics engine running entirely client-side.

---

## Key Capabilities

* **Unsupervised Regime Classification (Gaussian HMM)**: Establishes market states dynamically via a self-contained Gaussian Emission Hidden Markov Model trained using the Baum-Welch (Expectation-Maximization) algorithm and decoded using the Viterbi algorithm.
* **Heuristic State Discretization**: Support for Return-Standard Deviation Thresholds, Volatility Regimes (4-state), and Double Moving Average Crossover rules.
* **Markov Diagnostics & Solvers**:
  - *Stationary Distributions*: Solves the long-term steady-state probability vector $\pi$ using power iteration.
  - *Mean First Passage Time (MFPT)*: Computes the expected steps to transition between states using a custom Gaussian Elimination solver.
  - *Markov property test*: Performs a Chi-Square test of independence using a Wilson-Hilferty transformation to validate state memory.
* **Walk-Forward Validation (IS/OOS)**: Integrates In-Sample (IS / Train) and Out-of-Sample (OOS / Test) segmenting to assess predictive power on unseen data and prevent overfitting.
* **Trading Strategy Backtester**: Generates signals based on state-conditioned expected returns or transition probability thresholds, modeling transaction costs, risk-free rates, and calculating Sharpe Ratios and Maximum Drawdowns.
* **Monte Carlo Markov Chain (MCMC)**: Projects future price paths using state transition probabilities and empirical returns bootstrapping (resampling) to preserve fat-tail characteristics.
* **Interactive SVG Diagram**: Renders a circular state-transition graph highlighting outgoing pathways and probabilities on node hover.
* **Dual-Market Preloaded Data**: High-fidelity historical data for US & Global assets (`SPY`, `QQQ`, `BTC`, `GLD`) and Indian Markets (`NIFTY50`, `SENSEX`, `RELIANCE`, `TCS`), with support for custom CSV uploads.

---

## Mathematical Formulation

### 1. Hidden Markov Model (HMM) Baum-Welch
The model represents continuous returns $x_t$ emitted by $K$ hidden states. Emission densities are Gaussian:
$$P(x_t \mid S_t = i) = \mathcal{N}(x_t; \mu_i, \sigma_i^2) = \frac{1}{\sigma_i \sqrt{2\pi}} \exp\left( -\frac{(x_t - \mu_i)^2}{2\sigma_i^2} \right)$$

* **Expectation Step (E-step)**: Computes scaled forward variables $\hat{\alpha}_t(i)$ and backward variables $\hat{\beta}_t(i)$ to prevent numerical underflow over long sequences.
* **Maximization Step (M-step)**: Re-estimates transition probabilities $A_{ij}$, emission means $\mu_i$, and variances $\sigma_i^2$:
$$\mu_i = \frac{\sum_{t=0}^{T-1} \gamma_t(i) x_t}{\sum_{t=0}^{T-1} \gamma_t(i)}, \quad \sigma_i^2 = \frac{\sum_{t=0}^{T-1} \gamma_t(i) (x_t - \mu_i)^2}{\sum_{t=0}^{T-1} \gamma_t(i)}$$

### 2. Viterbi Decoding
Decodes the most likely hidden state path by maximizing log-joint probabilities recursively:
$$V_t(j) = \max_{i} \left[ V_{t-1}(i) + \ln A_{ij} \right] + \ln \mathcal{N}(x_t; \mu_j, \sigma_j^2)$$

### 3. Mean First Passage Time (MFPT)
The expected steps (days) $M_{ij}$ to travel from state $i$ to $j$ for the first time is solved via:
$$M_{ij} = 1 + \sum_{k \neq j} A_{ik} M_{kj} \quad \text{for } i \neq j, \quad M_{jj} = 0$$
This is solved for each column $j$ using Gaussian Elimination.

---

## Directory Structure

```
├── public/                 # Static assets (Favicons, vector resources)
├── src/
│   ├── components/
│   │   ├── QuantDashboard.jsx  # Main dashboard workspace, layout, and uploader
│   │   ├── StateDiagram.jsx    # SVG circular transition graph (interactive)
│   │   └── MetricCard.jsx      # Reusable KPI card components
│   ├── data/
│   │   └── preloadedData.js    # Brownian Bridge historical data generators
│   ├── utils/
│   │   └── quantEngine.js      # Core math, HMM, Viterbi, and backtest algorithms
│   ├── App.jsx             # Entrypoint rendering QuantDashboard
│   ├── App.css             # Vanilla CSS layout and glassmorphism styling
│   ├── index.css           # Global resets
│   └── main.jsx            # React root mounting
├── index.html              # HTML shell containing Outfit and Inter font links
├── vite.config.js          # Vite bundler parameters
└── package.json            # Dependencies (Chart.js, react-chartjs-2, Lucide icons)
```

---

## Quick Start

### 1. Installation
Clone the repository and install the dependencies:
```bash
git clone https://github.com/vengeanceXgt/markov-chain-quant-dashboard.git
cd markov-chain-quant-dashboard
npm install
```

### 2. Run Local Development Server
Launch the development server:
```bash
npm run dev
```
Open [http://localhost:5173/](http://localhost:5173/) in your web browser.

### 3. Production Build
Verify compilation and compile assets for production deployment:
```bash
npm run build
```

---

## Quantitative Strategy Methodology

The dashboard backtests a **Regime Momentum Strategy**:
1. At the end of trading day $t-1$, the system evaluates the current regime state $S_{t-1}$.
2. It projects the expected return $E[R_t \mid S_{t-1}]$ for the next session using the In-Sample transition matrix $P$ and state means $\bar{r}$:
$$E[R_t \mid S_{t-1}] = \sum_{j=0}^{M-1} P_{S_{t-1}, j} \cdot \bar{r}_j$$
3. If $E[R_t \mid S_{t-1}] > \text{Buy Threshold}$, the strategy takes a **Long** position (+1). If it falls below the **Sell Threshold**, the strategy takes a **Short** position (-1) or holds **Cash** (0) depending on exposure configurations.
4. Transaction fees are modeled by reducing returns by $\text{Tx Cost} \times \left| \text{Position}_t - \text{Position}_{t-1} \right|$ whenever a rebalancing trade occurs.
