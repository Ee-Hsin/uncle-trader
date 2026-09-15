"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { strategies } from "./strategy-data";
import { loadStrategy } from "@/lib/api-client";
import type { BacktestSuccessResponse } from "@/lib/contracts";
import { mapBacktestForDisplay } from "@/lib/presentation";
import { loadSavedStrategies, mergeSavedStrategies } from "@/lib/saved-strategies";
import {
  EquityCurve,
  GeneratedCodeDrawer,
  MetricsGrid,
  PanelIcon,
  StrategySidebar,
  TradeTable,
  useStrategySidebar,
} from "./strategy-workbench";
import type { BacktestResultsView, StrategyRecord } from "./types";

export function StrategyDetail({ strategy }: { strategy: StrategyRecord }) {
  const [backendStrategy, setBackendStrategy] = useState<StrategyRecord | null>(null);
  const [backtest, setBacktest] = useState<BacktestResultsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pastStrategies, setPastStrategies] = useState(strategies);
  const sidebar = useStrategySidebar(true);
  const displayStrategy = backendStrategy ?? strategy;
  const tickerBacktest = backtest?.results.find((result) => result.ticker === displayStrategy.ticker) ?? backtest?.results[0];
  const deployment = displayStrategy.deployment;

  useEffect(() => {
    const controller = new AbortController();
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
    const locallySavedStrategies = loadSavedStrategies(window.localStorage);
    const locallySaved = locallySavedStrategies.find((item) => item.id === strategy.id);
    setPastStrategies(mergeSavedStrategies(locallySavedStrategies, strategies));
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
    <main
      className={`savedStrategyShell ${sidebar.open ? "hasLeftSidebar" : ""} ${sidebar.resizing ? "isResizingSidebar" : ""}`}
      style={sidebar.style}
    >
      {sidebar.open ? (
        <StrategySidebar
          width={sidebar.width}
          strategies={pastStrategies}
          newStrategyHref="/"
          onClose={sidebar.closeSidebar}
          onResizeStart={sidebar.onResizeStart}
          onResizeMove={sidebar.onResizeMove}
          onResizeEnd={sidebar.onResizeEnd}
          onResizeKeyDown={sidebar.onResizeKeyDown}
        />
      ) : null}
      <section className="savedStrategyPage">
        <header className="savedStrategyTopbar">
          <div className="savedStrategyTopbarLeading">
            {!sidebar.open ? (
              <button
                type="button"
                ref={sidebar.toggleRef}
                className="toolbarButton"
                aria-label="Show strategy history"
                aria-expanded={false}
                aria-controls="strategy-history"
                onClick={sidebar.openSidebar}
              >
                <PanelIcon side="left" />
              </button>
            ) : null}
            <Link href="/" className="savedStrategyBack">← Back to strategies</Link>
          </div>
          <span>{loading ? "Refreshing results…" : `Last run ${displayStrategy.lastRun}`}</span>
        </header>
        <div className="savedStrategyContent">
          <header className="savedStrategyHero">
            <p>{displayStrategy.ticker}</p>
            <h1>{displayStrategy.name}</h1>
            <span>{displayStrategy.summary}</span>
          </header>

          <section className="savedPerformanceSection" aria-labelledby="deployed-pnl-title">
            <header>
              <p>Since deployment</p>
              <h2 id="deployed-pnl-title">Deployed P&amp;L</h2>
            </header>
            <article className="savedStrategyCard deployedPerformanceCard">
              <header>
                <span>Deployed P&amp;L</span>
                <strong>{deployment ? formatSignedMoney(deployment.pnl) : "—"}</strong>
              </header>
              {deployment?.pnlCurve.length ? (
                <LineChart points={deployment.pnlCurve} kind="pnl" />
              ) : (
                <p className="savedChartEmpty">
                  {displayStrategy.status === "active"
                    ? "No deployed P&L has been recorded yet."
                    : "Deploy this strategy to track its future P&L."}
                </p>
              )}
            </article>
          </section>

          <section className="savedStrategyMetrics" aria-label="Backtest summary">
            <Metric label="Backtest return" value={formatSignedPercent(displayStrategy.returnPercent)} tone={metricTone(displayStrategy.returnPercent)} />
            <Metric label="Backtest P&L" value={formatSignedMoney(displayStrategy.pnl)} tone={metricTone(displayStrategy.pnl)} />
            <Metric label="Last backtest" value={displayStrategy.lastRun} />
          </section>

          <section className="savedPerformanceSection" aria-labelledby="backtest-pnl-title">
            <header>
              <p>Historical simulation</p>
              <h2 id="backtest-pnl-title">Backtest P&amp;L</h2>
            </header>
            <div className="savedStrategyCharts" aria-label="Backtest graphs">
              <article className="savedStrategyCard">
                <header><span>Backtest P&amp;L</span><strong>{formatSignedMoney(displayStrategy.pnl)}</strong></header>
                {loading ? <GraphLoading /> : <LineChart points={displayStrategy.pnlCurve} kind="pnl" />}
              </article>
              <article className="savedStrategyCard">
                <header><span>Backtest account equity</span><strong>{formatMoney(displayStrategy.equityCurve.at(-1)?.equity ?? 0)}</strong></header>
                {loading ? <GraphLoading /> : <LineChart points={displayStrategy.equityCurve} kind="equity" />}
              </article>
            </div>
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
              {backtest.warnings.length ? (
                <div className="warningList">
                  <strong>Disclosures</strong>
                  <ul>{backtest.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
              ) : null}
              <GeneratedCodeDrawer code={backtest.generatedCode} />
            </section>
          ) : null}
        </div>
      </section>
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
  return new Intl.DateTimeFormat("en-US", value.includes("T")
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }
    : { month: "short", day: "numeric", timeZone: "UTC" }
  ).format(new Date(value));
}
