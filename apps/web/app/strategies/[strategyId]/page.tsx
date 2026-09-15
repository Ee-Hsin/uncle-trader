import { notFound } from "next/navigation";
import { StrategyDetail } from "@/components/strategy-detail";
import { getStrategy, strategies } from "@/components/strategy-data";

export function generateStaticParams() {
  return strategies.map((strategy) => ({ strategyId: strategy.id }));
}

export default async function StrategyPage({ params }: { params: Promise<{ strategyId: string }> }) {
  const { strategyId } = await params;
  const strategy = getStrategy(strategyId);

  if (!strategy) {
    notFound();
  }

  return <StrategyDetail strategy={strategy} />;
}
