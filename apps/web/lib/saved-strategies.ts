import type { StrategyRecord } from "../components/types";
import type { BacktestRequest, BacktestSuccessResponse } from "./contracts";

export const SAVED_STRATEGIES_KEY = "uncle-trading.saved-strategies.v1";
const SIDEBAR_CLEANUP_KEY = "uncle-trading.sidebar-cleanup.v1";
const REMOVED_STRATEGY_NAME = "tesla three-day dip";

type StrategyStorage = Pick<Storage, "getItem" | "setItem">;

export function strategyRecordFromDeployment(
  request: BacktestRequest,
  response: BacktestSuccessResponse,
): StrategyRecord {
  const result = response.results[0];
  const startingEquity = result.equity_curve[0].equity;
  const lastPoint = result.equity_curve.at(-1)!;

  return {
    id: response.strategy_id,
    name: request.strategy.name,
    ticker: request.strategy.target_tickers.join(", "),
    status: "active",
    returnPercent: result.metrics.total_return_percent,
    pnl: result.metrics.total_pnl,
    lastRun: formatDate(lastPoint.date),
    summary: response.strategy_summary,
    equityCurve: result.equity_curve,
    pnlCurve: result.equity_curve.map((point) => ({
      date: point.date,
      value: point.equity - startingEquity,
    })),
    deployment: {
      pnl: 0,
      pnlCurve: [],
    },
  };
}

export function mergeSavedStrategies(
  saved: StrategyRecord[],
  defaults: StrategyRecord[],
): StrategyRecord[] {
  const merged = new Map(defaults.map((strategy) => [strategy.id, strategy]));
  for (const strategy of saved) merged.set(strategy.id, strategy);
  return [...saved, ...defaults.filter((strategy) => !saved.some((savedStrategy) => savedStrategy.id === strategy.id))]
    .map((strategy) => merged.get(strategy.id)!);
}

export function upsertSavedStrategy(
  strategies: StrategyRecord[],
  strategy: StrategyRecord,
): StrategyRecord[] {
  return [strategy, ...strategies.filter((current) => current.id !== strategy.id)];
}

export function loadSavedStrategies(storage: StrategyStorage): StrategyRecord[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(SAVED_STRATEGIES_KEY) ?? "[]");
    const strategies = Array.isArray(value) ? value.filter(isStrategyRecord) : [];
    if (storage.getItem(SIDEBAR_CLEANUP_KEY) === "complete") return strategies;

    const removeIndex = strategies.findIndex(
      (strategy) => strategy.name.trim().toLowerCase() === REMOVED_STRATEGY_NAME,
    );
    const cleaned = removeIndex < 0
      ? strategies
      : strategies.filter((_, index) => index !== removeIndex);
    storage.setItem(SAVED_STRATEGIES_KEY, JSON.stringify(cleaned));
    storage.setItem(SIDEBAR_CLEANUP_KEY, "complete");
    return cleaned;
  } catch {
    return [];
  }
}

export function storeSavedStrategies(storage: StrategyStorage, strategies: StrategyRecord[]): void {
  try {
    storage.setItem(SAVED_STRATEGIES_KEY, JSON.stringify(strategies));
  } catch {
    return;
  }
}

function isStrategyRecord(value: unknown): value is StrategyRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StrategyRecord>;
  return typeof record.id === "string"
    && typeof record.name === "string"
    && typeof record.ticker === "string"
    && typeof record.returnPercent === "number"
    && typeof record.pnl === "number"
    && typeof record.lastRun === "string"
    && typeof record.summary === "string"
    && ["paper", "draft", "active"].includes(record.status ?? "")
    && Array.isArray(record.equityCurve)
    && Array.isArray(record.pnlCurve)
    && isDeploymentPerformance(record.deployment);
}

function isDeploymentPerformance(value: StrategyRecord["deployment"]): boolean {
  if (value === undefined) return true;
  return typeof value === "object"
    && value !== null
    && typeof value.pnl === "number"
    && Array.isArray(value.pnlCurve);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
