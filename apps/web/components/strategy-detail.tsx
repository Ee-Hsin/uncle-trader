"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { StrategyRecord } from "./types";

export function StrategyDetail({ strategy }: { strategy: StrategyRecord }) {
  const [openGraph, setOpenGraph] = useState<"pnl" | "equity" | null>(null);

  return (
    <main className="detailPage">
      <Link href="/" className="backLink">← Strategies</Link>
      <header className="detailHeader">
        <div>
          <p className="eyebrow">Paper strategy / {strategy.ticker}</p>
          <h1>{strategy.name}</h1>
          <p className="detailSummary">{strategy.summary}</p>
        </div>
        <span className="strategyStatus">Paper trading</span>
      </header>

      <section className="detailMetrics" aria-label="Strategy performance">
        <Metric label="Total return" value={`+${strategy.returnPercent.toFixed(1)}%`} positive />
        <Metric label="Total P&L" value={`+$${strategy.pnl.toLocaleString("en-US")}`} positive />
        <Metric label="Last run" value={strategy.lastRun} />
      </section>

      <section className="graphList" aria-label="Strategy graphs">
        <GraphDisclosure
          title="P&L over time"
          description="Cumulative paper profit and loss"
          open={openGraph === "pnl"}
          onToggle={() => setOpenGraph(openGraph === "pnl" ? null : "pnl")}
        >
          <LineChart points={strategy.pnlCurve} kind="pnl" />
        </GraphDisclosure>
        <GraphDisclosure
          title="Account equity"
          description="Paper account value from a $10,000 starting balance"
          open={openGraph === "equity"}
          onToggle={() => setOpenGraph(openGraph === "equity" ? null : "equity")}
        >
          <LineChart points={strategy.equityCurve} kind="equity" />
        </GraphDisclosure>
      </section>

      <p className="detailDisclosure">Historical paper-money results only. Fees and slippage are not included.</p>
    </main>
  );
}

function Metric({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="detailMetric">
      <span>{label}</span>
      <strong className={positive ? "positiveText" : ""}>{value}</strong>
    </div>
  );
}

function GraphDisclosure({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`graphDisclosure ${open ? "isOpen" : ""}`}>
      <button type="button" className="graphToggle" onClick={onToggle} aria-expanded={open}>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <span className="graphToggleIcon" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? <div className="graphContent">{children}</div> : null}
    </section>
  );
}

function LineChart({ points, kind }: { points: Array<{ date: string; value?: number; equity?: number }>; kind: "pnl" | "equity" }) {
  const chart = useMemo(() => {
    const values = points.map((point) => (kind === "pnl" ? point.value! : point.equity!));
    const min = Math.min(...values, kind === "pnl" ? 0 : Math.min(...values));
    const max = Math.max(...values, kind === "pnl" ? 0 : Math.max(...values));
    const range = Math.max(max - min, 1);
    const x = (index: number) => 40 + (index / Math.max(points.length - 1, 1)) * 680;
    const y = (value: number) => 24 + 236 - ((value - min) / range) * 236;
    return {
      min,
      max,
      line: values.map((value, index) => `${x(index)},${y(value)}`).join(" "),
      zero: y(0),
      firstDate: points[0].date,
      lastDate: points[points.length - 1].date,
    };
  }, [kind, points]);

  return (
    <figure className="detailChart">
      <figcaption>
        <span>{kind === "pnl" ? "Cumulative P&L" : "Portfolio value"}</span>
        <strong>{kind === "pnl" ? `+$${chart.max.toLocaleString("en-US")}` : `$${chart.max.toLocaleString("en-US")}`}</strong>
      </figcaption>
      <svg viewBox="0 0 760 300" role="img" aria-label={`${kind === "pnl" ? "Cumulative P&L" : "Account equity"} chart`} preserveAspectRatio="none">
        {[0, 1, 2, 3].map((line) => <line className="detailGridLine" key={line} x1="40" x2="720" y1={24 + line * 78.5} y2={24 + line * 78.5} />)}
        {kind === "pnl" ? <line className="zeroLine" x1="40" x2="720" y1={chart.zero} y2={chart.zero} /> : null}
        <polyline className={kind === "pnl" ? "pnlLine" : "equityLine"} points={chart.line} fill="none" />
        <text x="40" y="286">{formatDate(chart.firstDate)}</text>
        <text x="650" y="286">{formatDate(chart.lastDate)}</text>
      </svg>
    </figure>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}
