"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadStrategy } from "@/lib/api-client";
import type { BacktestSuccessResponse } from "@/lib/contracts";
import { mapBacktestForDisplay } from "@/lib/presentation";
import { loadSavedStrategies } from "@/lib/saved-strategies";
import { EquityCurve, GeneratedCodeDrawer, MetricsGrid, TradeTable } from "./strategy-workbench";
import type { BacktestResultsView, StrategyRecord } from "./types";

export function StrategyDetail({ strategy }: { strategy: StrategyRecord }) {
  const [backendStrategy, setBackendStrategy] = useState<StrategyRecord | null>(null);
  const [backtest, setBacktest] = useState<BacktestResultsView | null>(null);
  const [loading, setLoading] = useState(true);
  const displayStrategy = backendStrategy ?? strategy;
  const tickerBacktest = backtest?.results.find((result) => result.ticker === displayStrategy.ticker) ?? backtest?.results[0];

  useEffect(() => {
    const controller = new AbortController();
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
    const locallySaved = loadSavedStrategies(window.localStorage).find((item) => item.id === strategy.id);
    if (locallySaved) setBackendStrategy(locallySaved);

    loadStrategy(apiBaseUrl, strategy.id, controller.signal)
      .then((response) => {
        if (response.status !== "complete") throw new Error(response.error.message);
        setBackendStrategy(strategyRecordFromResponse(locallySaved ?? strategy, response));
        setBacktest(mapBacktestForDisplay(response));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [strategy]);

  return (
    <main className="savedStrategyPage">
      <header className="savedStrategyTopbar">
        <Link href="/" className="savedStrategyBack">← Back to strategies</Link>
        <span>{loading ? "Refreshing results…" : `Last run ${displayStrategy.lastRun}`}</span>
      </header>
      <div className="savedStrategyContent">
        <header className="savedStrategyHero">
          <p>{displayStrategy.ticker}</p>
          <h1>{displayStrategy.name}</h1>
          <span>{displayStrategy.summary}</span>
        </header>

        <section className="savedStrategyMetrics" aria-label="Strategy performance">
          <Metric label="Total return" value={formatSignedPercent(displayStrategy.returnPercent)} tone={metricTone(displayStrategy.returnPercent)} />
          <Metric label="Total P&L" value={formatSignedMoney(displayStrategy.pnl)} tone={metricTone(displayStrategy.pnl)} />
          <Metric label="Last run" value={displayStrategy.lastRun} />
        </section>

        <section className="savedStrategyCharts" aria-label="Strategy graphs">
          <article className="savedStrategyCard">
            <header><span>P&amp;L over time</span><strong>{formatSignedMoney(displayStrategy.pnl)}</strong></header>
            {loading ? <GraphLoading /> : <LineChart points={displayStrategy.pnlCurve} kind="pnl" />}
          </article>
          <article className="savedStrategyCard">
            <header><span>Account value</span><strong>{formatMoney(displayStrategy.equityCurve.at(-1)?.equity ?? 0)}</strong></header>
            {loading ? <GraphLoading /> : <LineChart points={displayStrategy.equityCurve} kind="equity" />}
          </article>
        </section>

        {backtest ? (
          <section className="savedStrategyDetails" aria-labelledby="full-backtest-title">
            <header>
              <p>Full backtest</p>
              <h2 id="full-backtest-title">Performance details</h2>
            </header>
            {backtest.results.map((result) => (
              <article className="savedTickerDetails" key={result.ticker}>
                <header>
                  <h3>{result.ticker}</h3>
                  <span>{result.trades.length} trades</span>
                </header>
                <MetricsGrid metrics={result.headlineMetrics} featured />
                <MetricsGrid metrics={result.metrics} />
                <EquityCurve points={result.equityCurve} trades={result.trades} />
                <TradeTable trades={result.trades} />
              </article>
            ))}
            {backtest?.warnings.length ? (
              <div className="warningList">
                <strong>Disclosures</strong>
                <ul>{backtest.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </div>
            ) : null}
            {backtest ? <GeneratedCodeDrawer code={backtest.generatedCode} /> : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

export function strategyRecordFromResponse(fallback: StrategyRecord, response: BacktestSuccessResponse): StrategyRecord {
  const result = response.results.find((item) => item.ticker === fallback.ticker) ?? response.results[0];
  const startingEquity = result.equity_curve[0].equity;
  const lastPoint = result.equity_curve.at(-1);
  return {
    ...fallback,
    ticker: result.ticker,
    summary: response.strategy_summary,
    returnPercent: result.metrics.total_return_percent,
    pnl: result.metrics.total_pnl,
    lastRun: lastPoint ? formatDate(lastPoint.date) : fallback.lastRun,
    equityCurve: result.equity_curve,
    pnlCurve: result.equity_curve.map((point) => ({
      date: point.date,
      value: point.equity - startingEquity,
    })),
  };
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatSignedMoney(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function metricTone(value: number): "positive" | "negative" | "neutral" {
  return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }) {
  return (
    <div className={`savedStrategyMetric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function GraphLoading() {
  return (
    <div className="graphLoading" role="status" aria-label="Loading graph data">
      <span className="graphLoadingLine" />
      <span className="graphLoadingLine short" />
    </div>
  );
}

function LineChart({ points, kind }: { points: Array<{ date: string; value?: number; equity?: number }>; kind: "pnl" | "equity" }) {
  const chart = useMemo(() => {
    if (points.length === 0) return null;
    const values = points.map((point) => (kind === "pnl" ? point.value! : point.equity!));
    const min = Math.min(...values, kind === "pnl" ? 0 : Math.min(...values));
    const max = Math.max(...values, kind === "pnl" ? 0 : Math.max(...values));
    const range = Math.max(max - min, 1);
    const x = (index: number) => 40 + (index / Math.max(points.length - 1, 1)) * 680;
    const y = (value: number) => 24 + 236 - ((value - min) / range) * 236;
    return {
      max,
      line: values.map((value, index) => `${x(index)},${y(value)}`).join(" "),
      zero: y(0),
      firstDate: points[0].date,
      lastDate: points[points.length - 1].date,
    };
  }, [kind, points]);

  if (!chart) return <p className="savedChartEmpty">No results are available.</p>;

  return (
    <figure className="detailChart">
      <figcaption>
        <span>{kind === "pnl" ? "Cumulative P&L" : "Portfolio value"}</span>
        <strong>{kind === "pnl" ? formatSignedMoney(chart.max) : formatMoney(chart.max)}</strong>
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
