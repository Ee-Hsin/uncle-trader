import type {
  BacktestResultsView,
  DeployView,
  EditableField,
  FieldState,
  Metric,
  StrategyDraftView,
} from "../components/types";
import type { BacktestResponse, DeployResponse } from "./contracts";
import type { ConversationDraft } from "./conversation";

function formatNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value);
}

function formatPercent(value: number | null): string {
  return value === null ? "Not enough data" : `${formatNumber(value)}%`;
}

function tone(value: number): Metric["tone"] {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

export function mapBacktestForDisplay(response: BacktestResponse): BacktestResultsView | null {
  if (response.status === "error") return null;
  return {
    strategyId: response.strategy_id,
    strategySummary: response.strategy_summary,
    generatedCode: response.generated_code,
    warnings: response.warnings,
    results: response.results.map((result) => ({
      ticker: result.ticker,
      equityCurve: result.equity_curve,
      trades: result.trades,
      headlineMetrics: [
        {
          label: "Total return",
          value: formatPercent(result.metrics.total_return_percent),
          tone: tone(result.metrics.total_return_percent),
        },
        { label: "Total P&L", value: formatMoney(result.metrics.total_pnl), tone: tone(result.metrics.total_pnl) },
        {
          label: "Buy and hold",
          value: formatPercent(result.metrics.buy_and_hold_return_percent),
          tone: tone(result.metrics.buy_and_hold_return_percent),
        },
      ],
      metrics: [
        {
          label: "Sharpe ratio",
          value: result.metrics.sharpe_ratio === null ? "Not enough data" : formatNumber(result.metrics.sharpe_ratio),
        },
        {
          label: "Average P&L per trade",
          value: formatMoney(result.metrics.average_pnl_per_trade),
          tone: tone(result.metrics.average_pnl_per_trade),
        },
        {
          label: "Expected value per trade",
          value: formatMoney(result.metrics.expected_value_per_trade),
          tone: tone(result.metrics.expected_value_per_trade),
        },
        { label: "Win rate", value: formatPercent(result.metrics.win_rate_percent) },
        {
          label: "Max drawdown",
          value: formatPercent(result.metrics.max_drawdown_percent),
          tone: tone(result.metrics.max_drawdown_percent),
        },
        { label: "Trade count", value: formatNumber(result.metrics.trade_count, 0) },
      ],
    })),
  };
}

function field(
  id: string,
  label: string,
  value: string | number | null,
  stateForPath: (path: string) => FieldState,
  options: Pick<EditableField, "input" | "options" | "helperText"> = {},
): EditableField {
  return { id, label, value: value === null ? "" : String(value), state: stateForPath(id), ...options };
}

export function mapDraftForDisplay(
  draft: ConversationDraft,
  stateForPath: (path: string) => FieldState,
): StrategyDraftView {
  const signalFields =
    draft.strategy.signal.source === "open_meteo"
      ? ["precipitation_sum", "temperature_2m_max", "temperature_2m_min"]
      : ["close", "volume"];
  const fields: EditableField[] = [
    field("strategy.name", "Strategy name", draft.strategy.name, stateForPath),
    field("strategy.thesis", "Thesis", draft.strategy.thesis, stateForPath),
    field("strategy.target_tickers", "Target tickers", draft.strategy.target_tickers?.join(", ") ?? null, stateForPath, {
      helperText: "One to five US stock or ETF tickers, separated by commas.",
    }),
    field("strategy.direction", "Direction", draft.strategy.direction, stateForPath, {
      input: "select",
      options: [
        { label: "Long", value: "long" },
        { label: "Short", value: "short" },
      ],
    }),
    field("strategy.signal.source", "Signal source", draft.strategy.signal.source, stateForPath, {
      input: "select",
      options: [
        { label: "Yahoo Finance", value: "yahoo" },
        { label: "Open-Meteo", value: "open_meteo" },
      ],
    }),
    field("strategy.signal.field", "Signal field", draft.strategy.signal.field, stateForPath, {
      input: "select",
      options: signalFields.map((value) => ({ label: value, value })),
    }),
  ];
  if (draft.strategy.signal.source === "yahoo") {
    fields.push(field("strategy.signal.symbol", "Signal symbol", draft.strategy.signal.symbol, stateForPath));
  }
  if (draft.strategy.signal.source === "open_meteo") {
    fields.push(
      field("strategy.signal.location.name", "Weather location", draft.strategy.signal.location?.name ?? null, stateForPath),
      field("strategy.signal.location.latitude", "Latitude", draft.strategy.signal.location?.latitude ?? null, stateForPath, { input: "number" }),
      field("strategy.signal.location.longitude", "Longitude", draft.strategy.signal.location?.longitude ?? null, stateForPath, { input: "number" }),
      field("strategy.signal.location.timezone", "Timezone", draft.strategy.signal.location?.timezone ?? null, stateForPath, {
        helperText: "Use an IANA timezone such as America/Toronto.",
      }),
    );
  }
  fields.push(
    field("strategy.signal.rule", "Entry condition", draft.strategy.signal.rule, stateForPath),
    field(
      "strategy.execution.holding_period_days",
      "Holding period, trading days",
      draft.strategy.execution.holding_period_days,
      stateForPath,
      { input: "number" },
    ),
    field(
      "strategy.execution.allocation_percent",
      "Allocation, percentage points",
      draft.strategy.execution.allocation_percent,
      stateForPath,
      { input: "number" },
    ),
    field("backtest.start_date", "Backtest start", draft.backtest.start_date, stateForPath, { input: "date" }),
    field("backtest.end_date", "Backtest end", draft.backtest.end_date, stateForPath, { input: "date" }),
    field("backtest.initial_capital", "Starting capital per ticker", draft.backtest.initial_capital, stateForPath, {
      input: "number",
    }),
  );
  const parameterLabels: Record<string, string> = {
    threshold: "Signal threshold",
    consecutive_observations: "Consecutive observations",
    lookback_days: "Lookback days",
    observation_frequency: "Observation frequency",
    comparison_window_days: "Comparison window days",
  };
  for (const [key, value] of Object.entries(draft.strategy.signal.parameters)) {
    if (value !== null) {
      fields.push(
        field(`strategy.signal.parameters.${key}`, parameterLabels[key] ?? key, value, stateForPath, {
          input: typeof value === "number" ? "number" : "text",
        }),
      );
    }
  }
  return {
    name: draft.strategy.name ?? "Untitled strategy",
    thesis: draft.strategy.thesis ?? "The strategy thesis is still missing.",
    targetTickers: draft.strategy.target_tickers ?? [],
    direction: draft.strategy.direction,
    signalSource: draft.strategy.signal.source,
    signalSymbol: draft.strategy.signal.symbol ?? undefined,
    signalField: draft.strategy.signal.field ?? "Missing",
    signalRule: draft.strategy.signal.rule ?? "Missing",
    parameters: Object.entries(draft.strategy.signal.parameters)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== null)
      .map(([label, value]) => ({ label, value: String(value) })),
    execution: {
      entryTiming: draft.strategy.execution.entry_timing ?? "next_trading_day_close",
      holdingPeriodDays: draft.strategy.execution.holding_period_days,
      allocationPercent: draft.strategy.execution.allocation_percent,
      ignoreOverlappingSignals: draft.strategy.execution.ignore_overlapping_signals ?? true,
    },
    fields,
  };
}

export function mapDeployForDisplay(response: DeployResponse | null, loading: boolean, canDeploy: boolean): DeployView {
  if (loading) return { state: "loading", helperText: "Activating the paper strategy." };
  if (response?.status === "active") {
    return { state: "active", strategyId: response.strategy_id, nextCheckAt: response.next_check_at };
  }
  if (response?.status === "error") return { state: "error", message: response.error.message };
  return {
    state: "idle",
    disabled: !canDeploy,
    helperText: canDeploy
      ? "A complete paper backtest is available for simulated activation."
      : "Complete a paper backtest before simulated activation.",
  };
}

export function fieldPathLabel(path: string): string {
  return path
    .replace(/^strategy\./, "")
    .replace(/^backtest\./, "backtest ")
    .replaceAll(".", " ")
    .replaceAll("_", " ");
}
