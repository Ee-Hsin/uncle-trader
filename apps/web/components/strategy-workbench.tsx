"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  BacktestResultsView,
  DeployView,
  EditableField,
  EquityPoint,
  FieldState,
  Metric,
  StrategyDraftView,
  StrategyWorkbenchProps,
  Trade,
} from "./types";
import { strategies } from "./strategy-data";

const defaultDraft: StrategyDraftView = {
  name: "FICO after three falling Treasury-yield closes",
  thesis: "A sustained decrease in the 10-year Treasury yield can support the valuation of FICO shares.",
  targetTickers: ["FICO"],
  direction: "long",
  signalSource: "yahoo",
  signalSymbol: "^TNX",
  signalField: "close",
  signalRule: "Enter long FICO when the Yahoo ^TNX daily close decreases for three consecutive observations.",
  parameters: [
    { label: "Consecutive observations", value: "3" },
    { label: "Observation frequency", value: "Daily" },
  ],
  execution: {
    entryTiming: "Next trading-day close",
    holdingPeriodDays: 5,
    allocationPercent: 20,
    ignoreOverlappingSignals: true,
  },
  fields: [
    { id: "ticker", label: "Target ticker", value: "FICO", state: "confirmed" },
    { id: "signal", label: "Signal symbol", value: "^TNX", state: "confirmed" },
    { id: "rule", label: "Entry condition", value: "Three falling daily closes", state: "proposed" },
    { id: "period", label: "Backtest dates", value: "Missing", state: "missing" },
  ],
};

const starterProps: StrategyWorkbenchProps = {
  stage: "missing",
  idea: "Buy when short-term Treasury yields begin trending above their longer-term average.",
  illustrative: true,
  messages: [
    {
      id: "a1",
      role: "assistant",
      text: "Describe the market, signal, and exit in your own words. I will separate what is confirmed from what still needs a decision.",
    },
  ],
  draft: defaultDraft,
  missingFields: ["Backtest start date", "Backtest end date"],
  deploy: {
    state: "idle",
    disabled: true,
    helperText: "Confirm the strategy and complete a backtest before simulated deployment.",
  },
};

export function StrategyWorkbench(props: Partial<StrategyWorkbenchProps>) {
  const view = { ...starterProps, ...props };
  const [composerOpen, setComposerOpen] = useState(false);
  const [ideaDraft, setIdeaDraft] = useState(view.idea);
  const isLoading = view.stage === "loading";
  const isFailure = view.stage === "failure";
  const ready = view.stage === "ready";

  useEffect(() => {
    if (!composerOpen) {
      setIdeaDraft(view.idea);
    }
  }, [composerOpen, view.idea]);

  useEffect(() => {
    if (!composerOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setComposerOpen(false);
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [composerOpen]);

  if (view.layout !== "workflow") {
    return (
      <section className="dashboard" aria-label="Trading strategies">
        <header className="dashboardHeader">
          <div>
            <p className="eyebrow">Uncle Trading</p>
            <h1>Strategies</h1>
          </div>
          <button type="button" onClick={() => setComposerOpen(true)}>
            <span aria-hidden="true">+</span> Add strategy
          </button>
        </header>
        <section className="dashboardEmpty" aria-labelledby="empty-dashboard-title">
          <p className="label">Your strategies</p>
          <h2 id="empty-dashboard-title">Build, test, repeat.</h2>
          <p>Open a strategy to review its paper performance, or add a new idea to your workspace.</p>
        </section>
        <div className="strategyList" aria-label="Strategies">
          {strategies.map((strategy) => (
            <Link className="strategyRow" href={`/strategies/${strategy.id}`} key={strategy.id}>
              <span className="strategyRowMain">
                <span className="strategyTicker">{strategy.ticker}</span>
                <span>
                  <strong>{strategy.name}</strong>
                  <small>{strategy.summary}</small>
                </span>
              </span>
              <span className="strategyRowStats">
                <span className="positiveText">+{strategy.returnPercent.toFixed(1)}%</span>
                <small>Paper return</small>
              </span>
              <span className="strategyRowArrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
        {composerOpen ? (
          <>
            <button type="button" className="drawerBackdrop" aria-label="Close add strategy panel" onClick={() => setComposerOpen(false)} />
            <aside className="composerDrawer" aria-label="Add strategy" aria-modal="true">
              <div className="drawerHeader">
                <div>
                  <p className="label">New strategy</p>
                  <h2>Add a trading strategy</h2>
                </div>
                <button type="button" className="iconButton" aria-label="Close add strategy panel" onClick={() => setComposerOpen(false)}>
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              <StrategyChat
                messages={view.messages}
                idea={ideaDraft}
                stage={view.stage}
                illustrative={view.illustrative}
                onIdeaChange={setIdeaDraft}
                onContinue={() => setComposerOpen(false)}
                compact
              />
              {view.draft ? <StrategyDraftPanel draft={view.draft} missingFields={view.missingFields ?? []} /> : null}
            </aside>
          </>
        ) : null}
      </section>
    );
  }

  return (
    <section className="workbench" aria-label="Strategy workflow">
      <div className="primaryColumn">
        <StrategyChat messages={view.messages} idea={view.idea} stage={view.stage} illustrative={view.illustrative} />
        {isLoading ? <BacktestProgress /> : null}
        {isFailure && view.error ? <FailurePanel title={view.error.title} message={view.error.message} /> : null}
        {view.results ? <BacktestResults results={view.results} /> : null}
      </div>
      <aside className="sideColumn" aria-label="Strategy review">
        {view.draft ? <StrategyDraftPanel draft={view.draft} missingFields={view.missingFields ?? []} /> : <EmptyDraftPanel />}
        <ConfirmationPanel ready={ready} loading={isLoading} />
        <DeployPanel deploy={view.deploy ?? starterProps.deploy!} />
      </aside>
    </section>
  );
}

export function StrategyChat({
  messages,
  idea,
  stage,
  illustrative,
  onIdeaChange,
  onContinue,
  compact = false,
}: Pick<StrategyWorkbenchProps, "messages" | "idea" | "stage" | "illustrative"> & {
  onIdeaChange?: (value: string) => void;
  onContinue?: () => void;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "chatPanel drawerChat" : "surface chatPanel"} aria-labelledby="chat-title">
      <div className="sectionHeader">
        <div>
          <p className="label">Conversation</p>
          <h2 id="chat-title">Trading idea</h2>
        </div>
        <StatusBadge state={stage === "empty" ? "missing" : "confirmed"} label={stage === "empty" ? "Empty" : "In progress"} />
      </div>
      {illustrative ? <p className="notice">Illustrative preview data. No market service is connected here.</p> : null}
      <div className="messageList" aria-label="Conversation messages">
        {messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <span className="messageRole">{message.role === "assistant" ? "Assistant" : "You"}</span>
            <p>{message.text}</p>
          </article>
        ))}
      </div>
      <label htmlFor="idea" className="fieldLabel">
        Trading idea
      </label>
      <textarea
        id="idea"
        value={idea}
        readOnly={!onIdeaChange}
        onChange={(event) => onIdeaChange?.(event.target.value)}
        placeholder="Describe a daily stock or ETF strategy."
      />
      <div className="actionRow">
        <span className="muted">{onIdeaChange ? "Add the idea in your own words." : "Preview state - no service connected."}</span>
        <button type="button" disabled={onIdeaChange ? idea.trim().length === 0 : true} onClick={onContinue}>
          Continue
        </button>
      </div>
    </section>
  );
}

export function StrategyDraftPanel({ draft, missingFields }: { draft: StrategyDraftView; missingFields: string[] }) {
  return (
    <section className="surface" aria-labelledby="draft-title">
      <div className="sectionHeader">
        <div>
          <p className="label">Draft strategy</p>
          <h2 id="draft-title">{draft.name}</h2>
        </div>
        <StatusBadge state={missingFields.length > 0 ? "missing" : "confirmed"} label={missingFields.length > 0 ? "Needs input" : "Ready"} />
      </div>
      <p className="bodyCopy">{draft.thesis}</p>
      <div className="fieldGrid">
        {draft.fields.map((field) => (
          <EditableStrategyField field={field} key={field.id} />
        ))}
      </div>
      <dl className="detailList">
        <div>
          <dt>Target tickers</dt>
          <dd>{draft.targetTickers.join(", ")}</dd>
        </div>
        <div>
          <dt>Direction</dt>
          <dd>{draft.direction}</dd>
        </div>
        <div>
          <dt>Signal</dt>
          <dd>
            {draft.signalSource} {draft.signalSymbol ? `- ${draft.signalSymbol}` : ""} - {draft.signalField}
          </dd>
        </div>
        <div>
          <dt>Execution</dt>
          <dd>
            {draft.execution.holdingPeriodDays} trading days - {draft.execution.allocationPercent}% allocation
          </dd>
        </div>
      </dl>
      {missingFields.length > 0 ? (
        <div className="callout" role="status">
          <strong>Missing values</strong>
          <ul>
            {missingFields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function EditableStrategyField({ field }: { field: EditableField }) {
  return (
    <label className="editableField">
      <span>
        {field.label}
        <StatusBadge state={field.state} label={field.state} />
      </span>
      <input value={field.value} readOnly aria-describedby={field.helperText ? `${field.id}-help` : undefined} />
      {field.helperText ? (
        <small id={`${field.id}-help`} className="muted">
          {field.helperText}
        </small>
      ) : null}
    </label>
  );
}

export function ConfirmationPanel({ ready, loading }: { ready: boolean; loading: boolean }) {
  return (
    <section className="surface compactSurface" aria-labelledby="confirm-title">
      <p className="label">Confirmation</p>
      <h2 id="confirm-title">Final review</h2>
      <p className="bodyCopy">Backtesting stays disabled until every required contract field is confirmed by the user.</p>
      <button type="button" disabled={!ready || loading} className="wideButton">
        {loading ? "Backtest running" : "Run historical paper backtest"}
      </button>
    </section>
  );
}

export function BacktestProgress() {
  return (
    <section className="surface progressPanel" aria-live="polite" aria-labelledby="progress-title">
      <p className="label">Backtest</p>
      <h2 id="progress-title">Running historical paper test</h2>
      <div className="progressTrack">
        <span />
      </div>
      <p className="muted">Generating checked strategy code, loading daily data, and calculating per-ticker results.</p>
    </section>
  );
}

export function BacktestResults({ results }: { results: BacktestResultsView }) {
  return (
    <section className="surface resultsPanel" aria-labelledby="results-title">
      <div className="sectionHeader">
        <div>
          <p className="label">Historical paper-money output</p>
          <h2 id="results-title">{results.strategySummary}</h2>
        </div>
        <StatusBadge state="confirmed" label="Complete" />
      </div>
      {results.results.map((result) => (
        <article className="tickerResult" key={result.ticker}>
          <h3>{result.ticker}</h3>
          <MetricsGrid metrics={result.headlineMetrics} featured />
          <MetricsGrid metrics={result.metrics} />
          <EquityCurve points={result.equityCurve} trades={result.trades} />
          <TradeTable trades={result.trades} />
        </article>
      ))}
      {results.warnings.length > 0 ? (
        <div className="warningList">
          <strong>Disclosures</strong>
          <ul>
            {results.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <GeneratedCodeDrawer code={results.generatedCode} />
    </section>
  );
}

export function MetricsGrid({ metrics, featured = false }: { metrics: Metric[]; featured?: boolean }) {
  return (
    <dl className={featured ? "metricsGrid featuredMetrics" : "metricsGrid"}>
      {metrics.map((metric) => (
        <div className={`metricCard ${metric.tone ?? "neutral"}`} key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EquityCurve({ points, trades }: { points: EquityPoint[]; trades: Trade[] }) {
  const chart = useMemo(() => buildChart(points, trades), [points, trades]);

  if (!chart) {
    return <p className="muted">No equity curve is available.</p>;
  }

  return (
    <figure className="chartFigure">
      <figcaption>Equity curve with entry and exit markers</figcaption>
      <svg viewBox="0 0 720 300" role="img" aria-labelledby="equity-title equity-desc" preserveAspectRatio="none">
        <title id="equity-title">Paper account equity over time</title>
        <desc id="equity-desc">
          Equity starts at {formatMoney(points[0].equity)} and ends at {formatMoney(points[points.length - 1].equity)}.
        </desc>
        <g className="gridLines">
          {[0, 1, 2, 3].map((line) => (
            <line key={line} x1="56" x2="688" y1={36 + line * 62} y2={36 + line * 62} />
          ))}
        </g>
        <polyline points={chart.line} fill="none" className="equityLine" />
        {chart.markers.map((marker) => (
          <circle className={marker.kind === "entry" ? "entryMarker" : "exitMarker"} cx={marker.x} cy={marker.y} r="5" key={`${marker.kind}-${marker.date}`} />
        ))}
        <text x="56" y="282">
          {formatDateShort(points[0].date)}
        </text>
        <text x="602" y="282">
          {formatDateShort(points[points.length - 1].date)}
        </text>
        <text x="12" y="44">
          {formatMoney(chart.max)}
        </text>
        <text x="12" y="232">
          {formatMoney(chart.min)}
        </text>
      </svg>
    </figure>
  );
}

export function TradeTable({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return <p className="emptyState">No completed trades in this historical period.</p>;
  }

  return (
    <div className="tableScroller">
      <table>
        <caption>Complete trade list</caption>
        <thead>
          <tr>
            <th scope="col">Entry date</th>
            <th scope="col">Exit date</th>
            <th scope="col">Direction</th>
            <th scope="col">Entry</th>
            <th scope="col">Exit</th>
            <th scope="col">Quantity</th>
            <th scope="col">P&amp;L</th>
            <th scope="col">Return</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={`${trade.entry_date}-${trade.exit_date}-${trade.entry_price}`}>
              <td>{formatDate(trade.entry_date)}</td>
              <td>{formatDate(trade.exit_date)}</td>
              <td>{trade.direction}</td>
              <td>{formatMoney(trade.entry_price)}</td>
              <td>{formatMoney(trade.exit_price)}</td>
              <td>{trade.quantity.toFixed(3)}</td>
              <td className={trade.pnl < 0 ? "negativeText" : "positiveText"}>{formatMoney(trade.pnl)}</td>
              <td className={trade.return_percent < 0 ? "negativeText" : "positiveText"}>{formatPercent(trade.return_percent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GeneratedCodeDrawer({ code }: { code: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="codeDrawer">
      <button type="button" className="secondaryButton" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        {open ? "Hide generated code" : "Show generated code"}
      </button>
      {open ? <pre>{code}</pre> : null}
    </div>
  );
}

export function DeployPanel({ deploy }: { deploy: DeployView }) {
  return (
    <section className="surface compactSurface" aria-labelledby="deploy-title">
      <p className="label">Simulated deployment</p>
      <h2 id="deploy-title">Activation</h2>
      {deploy.state === "active" ? (
        <p className="bodyCopy">
          Strategy {deploy.strategyId} is active for simulated checks. Next check:{" "}
          <time dateTime={deploy.nextCheckAt}>{formatDateTime(deploy.nextCheckAt)}</time>.
        </p>
      ) : deploy.state === "error" ? (
        <p className="errorText">{deploy.message}</p>
      ) : (
        <p className="bodyCopy">{deploy.helperText}</p>
      )}
      <button type="button" disabled={deploy.state !== "idle" || deploy.disabled} className="wideButton">
        {deploy.state === "loading" ? "Activating" : deploy.state === "active" ? "Simulated active" : "Activate simulation"}
      </button>
    </section>
  );
}

export function StatusBadge({ state, label }: { state: FieldState; label: string }) {
  return <span className={`statusBadge ${state}`}>{label}</span>;
}

function EmptyDraftPanel() {
  return (
    <section className="surface emptyState" aria-labelledby="empty-draft-title">
      <p className="label">Draft strategy</p>
      <h2 id="empty-draft-title">No strategy yet</h2>
      <p>Start with a plain-language idea. Required values will appear here as they are proposed or confirmed.</p>
    </section>
  );
}

function FailurePanel({ title, message }: { title: string; message: string }) {
  return (
    <section className="surface failurePanel" aria-labelledby="failure-title">
      <p className="label">Needs attention</p>
      <h2 id="failure-title">{title}</h2>
      <p>{message}</p>
      <button type="button">Retry backtest</button>
    </section>
  );
}

function buildChart(points: EquityPoint[], trades: Trade[]) {
  if (points.length === 0) {
    return null;
  }

  const width = 632;
  const height = 198;
  const left = 56;
  const top = 32;
  const values = points.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const xForIndex = (index: number) => left + (index / Math.max(points.length - 1, 1)) * width;
  const yForValue = (value: number) => top + height - ((value - min) / range) * height;
  const byDate = new Map(points.map((point, index) => [point.date, { point, index }]));

  return {
    min,
    max,
    line: points.map((point, index) => `${xForIndex(index)},${yForValue(point.equity)}`).join(" "),
    markers: trades.flatMap((trade) =>
      [
        { kind: "entry" as const, date: trade.entry_date },
        { kind: "exit" as const, date: trade.exit_date },
      ].flatMap((marker) => {
        const match = byDate.get(marker.date);
        return match ? [{ ...marker, x: xForIndex(match.index), y: yForValue(match.point.equity) }] : [];
      }),
    ),
  };
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value);
}

export function formatPercent(value: number | null) {
  return value === null ? "Not enough data" : `${value < 0 ? "loss " : ""}${value.toFixed(1)}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function formatDateShort(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}
