import type { StrategyRecord } from "./types";

export const strategies: StrategyRecord[] = [
  {
    id: "fico-tnx-down-3d",
    name: "FICO / falling Treasury yields",
    ticker: "FICO",
    status: "paper",
    returnPercent: 3.1,
    pnl: 310,
    lastRun: "Apr 16, 2024",
    summary: "Buy FICO after the 10-year Treasury yield closes lower for three consecutive days. Hold for five trading days.",
    equityCurve: [
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
    ],
    pnlCurve: [
      { date: "2024-04-01", value: 0 },
      { date: "2024-04-02", value: 0 },
      { date: "2024-04-03", value: 0 },
      { date: "2024-04-04", value: 20 },
      { date: "2024-04-05", value: 90 },
      { date: "2024-04-08", value: 40 },
      { date: "2024-04-09", value: 160 },
      { date: "2024-04-10", value: 120 },
      { date: "2024-04-11", value: 200 },
      { date: "2024-04-12", value: 180 },
      { date: "2024-04-15", value: 270 },
      { date: "2024-04-16", value: 310 },
    ],
  },
];

export function getStrategy(id: string) {
  return strategies.find((strategy) => strategy.id === id);
}
