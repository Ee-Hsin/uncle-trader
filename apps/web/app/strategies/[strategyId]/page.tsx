import { StrategyDetail } from "@/components/strategy-detail";
import { getStrategy, strategies } from "@/components/strategy-data";
import type { StrategyRecord } from "@/components/types";

export function generateStaticParams() {
  return strategies.map((strategy) => ({ strategyId: strategy.id }));
}

export default async function StrategyPage({ params }: { params: Promise<{ strategyId: string }> }) {
  const { strategyId } = await params;
  const strategy = getStrategy(strategyId) ?? loadingStrategy(strategyId);

  return <StrategyDetail strategy={strategy} />;
}

function loadingStrategy(strategyId: string): StrategyRecord {
  return {
    id: strategyId,
    name: strategyId
      .split("-")
      .filter(Boolean)
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" "),
    ticker: "—",
    status: "active",
    returnPercent: 0,
    pnl: 0,
    lastRun: "Loading…",
    summary: "Loading the saved strategy and its latest backtest.",
    equityCurve: [],
    pnlCurve: [],
  };
}
