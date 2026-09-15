import { StrategyWorkbench } from "@/components/strategy-workbench";
import type { BacktestResultsView, StrategyDraftView, StrategyWorkbenchProps } from "@/components/types";

const generatedCode = `class Strategy:
    def required_data(self):
        return [{"key": "signal", "source": "yahoo", "symbol": "^TNX", "field": "close"}]

    def generate_signals(self, data):
        signals = []
        previous_value = None
        decrease_count = 0
        for row in data["signal"]:
            value = row["value"]
            if previous_value is not None and value < previous_value:
                decrease_count += 1
            else:
                decrease_count = 0
            if decrease_count >= 3:
                signals.append({"ticker": "FICO", "signal_date": row["date"], "direction": "long"})
            previous_value = value
        return signals`;

const draft: StrategyDraftView = {
  name: "FICO after three falling Treasury-yield closes",
  thesis: "A sustained decrease in the 10-year Treasury yield can support the valuation of FICO shares.",
  targetTickers: ["FICO"],
  direction: "long",
  signalSource: "yahoo",
  signalSymbol: "^TNX",
  signalField: "close",
  signalRule: "Enter long FICO when the Yahoo ^TNX daily close decreases for three consecutive observations.",
  parameters: [
    { label: "consecutive_observations", value: "3" },
    { label: "observation_frequency", value: "daily" },
  ],
  execution: {
    entryTiming: "next_trading_day_close",
    holdingPeriodDays: 5,
    allocationPercent: 20,
    ignoreOverlappingSignals: true,
  },
  fields: [
    { id: "name", label: "Strategy name", value: "FICO after three falling Treasury-yield closes", state: "confirmed" },
    { id: "tickers", label: "Target tickers", value: "FICO", state: "confirmed" },
    { id: "signal", label: "Signal symbol", value: "^TNX", state: "confirmed", helperText: "Yahoo daily close signal" },
    { id: "rule", label: "Entry condition", value: "Three falling daily closes", state: "proposed" },
    { id: "dates", label: "Backtest period", value: "2015-01-01 to 2025-12-31", state: "confirmed" },
    { id: "allocation", label: "Allocation", value: "20%", state: "confirmed" },
  ],
};

const equityCurve = [
  { date: "2024-04-01", equity: 10000 },
  { date: "2024-04-02", equity: 10000 },
  { date: "2024-04-03", equity: 10000 },
  { date: "2024-04-04", equity: 10020 },
  { date: "2024-04-05", equity: 10090 },
  { date: "2024-04-08", equity: 10040 },
  { date: "2024-04-09", equity: 10160 },
  { date: "2024-04-10", equity: 10120 },
  { date: "2024-04-11", equity: 10200 },
  { date: "2024-04-12", equity: 10180 },
  { date: "2024-04-15", equity: 10270 },
  { date: "2024-04-16", equity: 10310 },
];

const trades = [
  {
    entry_date: "2024-04-04",
    exit_date: "2024-04-11",
    direction: "long" as const,
    entry_price: 480,
    exit_price: 528,
    quantity: 4.167,
    pnl: 200,
    return_percent: 10,
  },
  {
    entry_date: "2024-04-08",
    exit_date: "2024-04-15",
    direction: "long" as const,
    entry_price: 512,
    exit_price: 535,
    quantity: 3.945,
    pnl: 90.74,
    return_percent: 4.5,
  },
  {
    entry_date: "2024-04-09",
    exit_date: "2024-04-16",
    direction: "long" as const,
    entry_price: 526,
    exit_price: 515,
    quantity: 3.867,
    pnl: -42.54,
    return_percent: -2.1,
  },
];

const results: BacktestResultsView = {
  strategyId: "fico-tnx-down-3d",
  strategySummary: "Buy FICO at the next trading-day close after ^TNX closes lower for three consecutive observations, then hold for five trading days.",
  generatedCode,
  warnings: [
    "This is a paper-money simulation only.",
    "Fees and slippage are not included.",
    "Historical results do not predict future results.",
  ],
  results: [
    {
      ticker: "FICO",
      headlineMetrics: [
        { label: "Total return", value: formatPercent(3.1), tone: "positive" },
        { label: "Total P&L", value: formatMoney(310), tone: "positive" },
        { label: "Buy and hold", value: formatPercent(31.2), tone: "positive" },
      ],
      metrics: [
        { label: "Sharpe ratio", value: "1.18" },
        { label: "Average P&L per trade", value: formatMoney(82.73), tone: "positive" },
        { label: "Expected value per trade", value: formatMoney(82.73), tone: "positive" },
        { label: "Win rate", value: formatPercent(66.7), tone: "positive" },
        { label: "Max drawdown", value: formatPercent(-0.7), tone: "negative" },
        { label: "Trade count", value: "3" },
      ],
      equityCurve,
      trades,
    },
  ],
};

const baseMessages = [
  {
    id: "a1",
    role: "assistant" as const,
    text: "Tell me the ticker, signal, holding period, allocation, and backtest dates you want to use.",
  },
  {
    id: "u1",
    role: "user" as const,
    text: "Test buying FICO when the 10-year Treasury yield has fallen three days in a row.",
  },
];

const scenarios: Array<{ title: string; props: StrategyWorkbenchProps }> = [
  {
    title: "Empty idea",
    props: {
      stage: "empty",
      idea: "",
      messages: [baseMessages[0]],
      illustrative: true,
      missingFields: ["Trading idea"],
    },
  },
  {
    title: "Missing values",
    props: {
      stage: "missing",
      idea: baseMessages[1].text,
      messages: baseMessages,
      draft: {
        ...draft,
        fields: draft.fields.map((field) => (field.id === "dates" ? { ...field, value: "Missing", state: "missing" as const } : field)),
      },
      missingFields: ["Backtest start date", "Backtest end date"],
      illustrative: true,
    },
  },
  {
    title: "Ready for final confirmation",
    props: {
      stage: "ready",
      idea: baseMessages[1].text,
      messages: [
        ...baseMessages,
        { id: "a2", role: "assistant" as const, text: "I have the required values. Please review them before starting the paper backtest." },
      ],
      draft: { ...draft, fields: draft.fields.map((field) => ({ ...field, state: "confirmed" as const })) },
      missingFields: [],
      illustrative: true,
    },
  },
  {
    title: "Backtest loading",
    props: {
      stage: "loading",
      idea: baseMessages[1].text,
      messages: baseMessages,
      draft,
      missingFields: [],
      illustrative: true,
    },
  },
  {
    title: "Complete results",
    props: {
      stage: "complete",
      idea: baseMessages[1].text,
      messages: baseMessages,
      draft,
      results,
      deploy: { state: "idle", helperText: "A complete paper backtest is available for simulated activation." },
      illustrative: true,
    },
  },
  {
    title: "Failure with retry",
    props: {
      stage: "failure",
      idea: baseMessages[1].text,
      messages: baseMessages,
      draft,
      error: {
        title: "Backtest could not run",
        message: "Historical data was unavailable for one requested input. Review the signal or try again.",
      },
      illustrative: true,
    },
  },
  {
    title: "Simulated deployment active",
    props: {
      stage: "active",
      idea: baseMessages[1].text,
      messages: baseMessages,
      draft,
      results,
      deploy: {
        state: "active",
        strategyId: "fico-tnx-down-3d",
        nextCheckAt: "2026-09-16T20:00:00Z",
      },
      illustrative: true,
    },
  },
];

export default function UiPreviewPage() {
  return (
    <main>
      <header className="hero previewHero">
        <p className="eyebrow">UI preview - illustrative data</p>
        <h1>Sophia frontend states</h1>
        <p className="heroCopy">Presentational components only. These examples use contract-shaped FICO and ^TNX mock data without network calls.</p>
      </header>
      <div className="previewStack">
        {scenarios.map((scenario) => (
          <section className="previewScenario" aria-labelledby={`${scenario.title}-title`} key={scenario.title}>
            <h2 id={`${scenario.title}-title`}>{scenario.title}</h2>
            <StrategyWorkbench {...scenario.props} />
          </section>
        ))}
      </div>
    </main>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value);
}

function formatPercent(value: number | null) {
  return value === null ? "Not enough data" : `${value < 0 ? "loss " : ""}${value.toFixed(1)}%`;
}
