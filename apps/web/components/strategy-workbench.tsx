"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import type {
  BacktestResultsView,
  DeployView,
  EditableField,
  EquityPoint,
  Metric,
  StrategyDraftView,
  StrategyWorkbenchProps,
  TickerBacktestResult,
  Trade,
} from "./types";
import { strategies } from "./strategy-data";

const DEFAULT_SIDEBAR_WIDTH = 260;
const MINIMUM_DRAG_WIDTH = 140;
const SIDEBAR_CLOSE_THRESHOLD = 180;
const MAXIMUM_SIDEBAR_WIDTH = 420;
const KEYBOARD_RESIZE_STEP = 16;

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
  stage: "empty",
  idea: "",
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
    helperText: "Complete a backtest before deployment.",
  },
};

export function useStrategySidebar(initialOpen = true) {
  const [open, setOpen] = useState(initialOpen);
  const [width, setWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [resizing, setResizing] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const widthValue = useRef(DEFAULT_SIDEBAR_WIDTH);
  const resizeStart = useRef<{ pointerId: number; clientX: number; width: number } | null>(null);
  const updateWidth = (next: number) => {
    const constrained = Math.min(MAXIMUM_SIDEBAR_WIDTH, Math.max(MINIMUM_DRAG_WIDTH, next));
    widthValue.current = constrained;
    setWidth(constrained);
  };
  const openSidebar = () => {
    if (widthValue.current <= SIDEBAR_CLOSE_THRESHOLD) updateWidth(DEFAULT_SIDEBAR_WIDTH);
    setOpen(true);
  };
  const closeSidebar = () => {
    setOpen(false);
    requestAnimationFrame(() => toggleRef.current?.focus());
  };
  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || resizeStart.current) return;
    resizeStart.current = { pointerId: event.pointerId, clientX: event.clientX, width: widthValue.current };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  };
  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    updateWidth(start.width + event.clientX - start.clientX);
  };
  const onResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    resizeStart.current = null;
    setResizing(false);
    if (widthValue.current <= SIDEBAR_CLOSE_THRESHOLD) {
      updateWidth(DEFAULT_SIDEBAR_WIDTH);
      closeSidebar();
    }
  };
  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      closeSidebar();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      updateWidth(MAXIMUM_SIDEBAR_WIDTH);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = widthValue.current + (event.key === "ArrowLeft" ? -KEYBOARD_RESIZE_STEP : KEYBOARD_RESIZE_STEP);
    if (next <= SIDEBAR_CLOSE_THRESHOLD) {
      updateWidth(DEFAULT_SIDEBAR_WIDTH);
      closeSidebar();
      return;
    }
    updateWidth(next);
  };

  return {
    open,
    width,
    resizing,
    toggleRef,
    style: { "--strategy-sidebar-width": `${width}px` } as CSSProperties,
    openSidebar,
    closeSidebar,
    onResizeStart,
    onResizeMove,
    onResizeEnd,
    onResizeKeyDown,
  };
}

export function StrategyWorkbench(props: Partial<StrategyWorkbenchProps>) {
  const view = { ...starterProps, ...props };
  const isLoading = view.stage === "loading";
  const isFailure = view.stage === "failure";
  const hasDraft = view.hasDraft ?? view.stage !== "empty";
  const hasConversation = view.messages.length > 1 || Boolean(view.chatLoading) || Boolean(view.chatError);
  const showConversation = hasDraft || hasConversation;
  const sidebar = useStrategySidebar(view.layout !== "workflow");
  const [inspectorOpen, setInspectorOpen] = useState(hasDraft);
  const draftHasOpened = useRef(hasDraft);
  const inspectorToggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!hasDraft) {
      draftHasOpened.current = false;
      setInspectorOpen(false);
      return;
    }
    if (!draftHasOpened.current) {
      draftHasOpened.current = true;
      setInspectorOpen(true);
    }
  }, [hasDraft]);

  const canRunBacktest = ["ready", "complete", "failure", "active"].includes(view.stage);
  const deployView = view.deploy ?? starterProps.deploy!;
  const activity = (
    <>
      {isLoading ? <BacktestProgress /> : null}
      {isFailure && view.error ? <FailurePanel title={view.error.title} message={view.error.message} /> : null}
      {view.results ? <BacktestResults results={view.results} /> : null}
    </>
  );
  const shellClassName = [
    "strategyAppShell",
    sidebar.open ? "hasLeftSidebar" : "",
    inspectorOpen && hasDraft ? "hasInspector" : "",
    sidebar.resizing ? "isResizingSidebar" : "",
  ].filter(Boolean).join(" ");
  const closeInspector = () => {
    setInspectorOpen(false);
    requestAnimationFrame(() => inspectorToggle.current?.focus());
  };

  return (
    <section className={shellClassName} style={sidebar.style} aria-label="Uncle Trading workspace">
      {sidebar.open ? (
        <StrategySidebar
          width={sidebar.width}
          strategies={view.pastStrategies ?? strategies}
          onNewStrategy={view.onNewStrategy}
          onClose={sidebar.closeSidebar}
          onResizeStart={sidebar.onResizeStart}
          onResizeMove={sidebar.onResizeMove}
          onResizeEnd={sidebar.onResizeEnd}
          onResizeKeyDown={sidebar.onResizeKeyDown}
        />
      ) : null}
      <section className="strategyMain">
        <header className="workspaceToolbar">
          {sidebar.open ? <span className="toolbarSpacer" aria-hidden="true" /> : (
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
          )}
          <span className="workspaceTitle">{hasDraft ? view.draft?.name : null}</span>
          {hasDraft && !inspectorOpen ? (
            <button
              type="button"
              ref={inspectorToggle}
              className="toolbarButton"
              aria-label={inspectorOpen ? "Hide strategy details" : "Show strategy details"}
              aria-expanded={inspectorOpen}
              aria-controls="strategy-details"
              onClick={() => setInspectorOpen((current) => !current)}
            >
              <PanelIcon side="right" />
            </button>
          ) : <span className="toolbarSpacer" aria-hidden="true" />}
        </header>
        <div className={showConversation ? "conversationWorkspace" : "chatHomeMain"}>
          {!showConversation ? (
            <header className="chatHomeHeader">
              <h1>Describe a trading idea</h1>
              <p>Uncle will build it.</p>
            </header>
          ) : null}
          <StrategyChat
            messages={view.messages}
            idea={view.idea}
            loading={view.chatLoading}
            error={view.chatError}
            activity={activity}
            showStrategyActions={hasDraft}
            canRunBacktest={canRunBacktest}
            backtestLoading={isLoading}
            hasResults={Boolean(view.results)}
            deploy={deployView}
            suggestions={!showConversation ? [
              {
                label: "Buy Tesla after three down days",
                value: "Buy Tesla when it falls for three trading days in a row, then hold it for five trading days.",
              },
              {
                label: "Buy ADM after heavy Iowa rain",
                value: "Buy ADM when Iowa receives more than 25 mm of rain in a day, then hold it for five trading days.",
              },
            ] : undefined}
            onIdeaChange={view.onIdeaChange}
            onSubmit={view.onSubmitIdea}
            onRunBacktest={view.onRunBacktest}
            onDeploy={view.onDeploy}
          />
        </div>
      </section>
      {inspectorOpen && hasDraft ? (
        <aside id="strategy-details" className="strategyInspector" aria-label="Strategy details">
          <header className="inspectorHeader">
            <h2>Strategy details</h2>
            <button type="button" className="toolbarButton" aria-label="Hide strategy details" onClick={closeInspector}>
              <CloseIcon />
            </button>
          </header>
          {view.draft ? (
            <StrategyDraftPanel
              draft={view.draft}
              missingFields={view.missingFields ?? []}
              onFieldChange={view.onFieldChange}
            />
          ) : <EmptyDraftPanel />}
        </aside>
      ) : null}
    </section>
  );
}

export function StrategySidebar({
  width,
  strategies,
  onNewStrategy,
  newStrategyHref,
  onClose,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onResizeKeyDown,
}: {
  width: number;
  strategies: StrategyWorkbenchProps["pastStrategies"];
  onNewStrategy?: () => void;
  newStrategyHref?: string;
  onClose: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <aside id="strategy-history" className="strategySidebar" aria-label="Past trading strategies">
      <div className="sidebarBrand">
        <Link
          className="sidebarIdentity"
          href={newStrategyHref ?? "/"}
          aria-label="Start a new strategy"
          onClick={(event) => {
            if (!onNewStrategy) return;
            event.preventDefault();
            onNewStrategy();
          }}
        >
          <img className="sidebarLogo" src="/uncle-trading-icon.png" alt="" width="30" height="30" />
          <span className="sidebarTitle">Uncle Trading</span>
        </Link>
        <button type="button" className="toolbarButton" aria-label="Hide strategy history" onClick={onClose}>
          <PanelIcon side="left" />
        </button>
      </div>
      {onNewStrategy ? (
        <button type="button" className="newStrategyButton" onClick={onNewStrategy}>
          <span aria-hidden="true">+</span> New strategy
        </button>
      ) : (
        <Link className="newStrategyButton" href={newStrategyHref ?? "/"}>
          <span aria-hidden="true">+</span> New strategy
        </Link>
      )}
      <div className="sidebarSection">
        <p className="sidebarLabel">Past strategies</p>
        <nav aria-label="Saved trading strategies">
          {strategies?.map((strategy) => (
            <Link className="sidebarStrategy" href={`/strategies/${strategy.id}`} key={strategy.id}>
              <span className="sidebarStrategyIcon" aria-hidden="true">{strategy.ticker.slice(0, 1)}</span>
              <span className="sidebarStrategyCopy">
                <strong>{strategy.name}</strong>
                <small>{strategy.ticker} · {strategy.lastRun}</small>
              </span>
            </Link>
          ))}
        </nav>
      </div>
      <div
        className="sidebarResizeHandle"
        role="separator"
        aria-label="Resize strategy history"
        aria-orientation="vertical"
        aria-valuemin={MINIMUM_DRAG_WIDTH}
        aria-valuemax={MAXIMUM_SIDEBAR_WIDTH}
        aria-valuenow={Math.round(width)}
        aria-valuetext={width <= SIDEBAR_CLOSE_THRESHOLD ? "Release to close" : `${Math.round(width)} pixels`}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onKeyDown={onResizeKeyDown}
      />
    </aside>
  );
}

export function StrategyChat({
  messages,
  idea,
  onIdeaChange,
  onSubmit,
  loading = false,
  error,
  activity,
  showStrategyActions = false,
  canRunBacktest = false,
  backtestLoading = false,
  hasResults = false,
  deploy,
  suggestions,
  compact = false,
  onRunBacktest,
  onDeploy,
}: Pick<StrategyWorkbenchProps, "messages" | "idea"> & {
  onIdeaChange?: (value: string) => void;
  onSubmit?: () => void;
  loading?: boolean;
  error?: string;
  activity?: ReactNode;
  showStrategyActions?: boolean;
  canRunBacktest?: boolean;
  backtestLoading?: boolean;
  hasResults?: boolean;
  deploy?: DeployView;
  suggestions?: Array<{ label: string; value: string }>;
  compact?: boolean;
  onRunBacktest?: () => void;
  onDeploy?: () => void;
}) {
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const chatClassName = [
    compact ? "chatPanel drawerChat" : "chatPanel strategyChat",
    loading ? "isChatLoading" : "",
  ].filter(Boolean).join(" ");

  useEffect(() => {
    resizeComposerInput(composerInput.current);
  }, [idea]);

  return (
    <section className={chatClassName} aria-label="Strategy conversation">
      {error ? <p className="errorText" role="alert">{error}</p> : null}
      <div className="messageList" aria-label="Conversation messages">
        {messages.map((message) => (
          <article
            className={`message ${message.role}`}
            aria-label={message.role === "assistant" ? "Uncle Trading" : "You"}
            key={message.id}
          >
            <p>{message.text}</p>
          </article>
        ))}
        {loading ? (
          <article className="message assistant typingMessage" aria-label="Uncle Trading is responding" aria-live="polite">
            <span className="typingIndicator" aria-hidden="true"><i /><i /><i /></span>
          </article>
        ) : null}
        {activity}
      </div>
      <form
        className={`chatComposer ${suggestions?.length ? "hasSuggestions" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.();
        }}
      >
        <textarea
          id="idea"
          ref={composerInput}
          rows={1}
          aria-label="Message Uncle Trading"
          maxLength={4_000}
          value={idea}
          readOnly={!onIdeaChange}
          onChange={(event) => {
            resizeComposerInput(event.currentTarget);
            onIdeaChange?.(event.target.value);
          }}
          placeholder="Describe a stock or ETF strategy."
        />
        <div className="composerFooter">
          <div className="composerLeading">
            {suggestions?.length ? (
              <div className="composerSuggestions" aria-label="Example strategy ideas">
                {suggestions.map((suggestion) => (
                  <button type="button" key={suggestion.value} onClick={() => onIdeaChange?.(suggestion.value)}>
                    {suggestion.label}
                  </button>
                ))}
              </div>
            ) : null}
            {showStrategyActions ? (
              <div className="chatWorkflowActions" aria-label="Strategy actions">
              <button
                type="button"
                className={hasResults ? "quietButton" : "compactActionButton"}
                disabled={!canRunBacktest || backtestLoading || !onRunBacktest}
                onClick={onRunBacktest}
              >
                {backtestLoading ? "Running backtest…" : hasResults ? "Run again" : "Run backtest"}
              </button>
              <button
                type="button"
                className={hasResults ? "compactActionButton" : "quietButton"}
                disabled={!deploy || !onDeploy || deploy.state !== "idle" || deploy.disabled}
                onClick={onDeploy}
              >
                {deploy?.state === "loading" ? "Deploying…" : deploy?.state === "active" ? "Deployed" : "Deploy"}
              </button>
              </div>
            ) : null}
          </div>
          <button className="sendButton" type="submit" disabled={!onSubmit || idea.trim().length === 0 || loading}>
            Send
          </button>
        </div>
      </form>
      {deploy?.state === "error" ? <p className="deploymentError" role="alert">{deploy.message}</p> : null}
    </section>
  );
}

function resizeComposerInput(input: HTMLTextAreaElement | null) {
  if (!input) return;
  input.style.height = "0px";
  const contentHeight = input.scrollHeight;
  const nextHeight = Math.min(Math.max(contentHeight, 32), 180);
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = contentHeight > 180 ? "auto" : "hidden";
}

export function StrategyDraftPanel({
  draft,
  missingFields,
  onFieldChange,
}: {
  draft: StrategyDraftView;
  missingFields: string[];
  onFieldChange?: (fieldId: string, value: string) => void;
}) {
  return (
    <section className="strategyDraft" aria-label="Editable strategy fields">
      <div className="fieldGrid">
        {draft.fields.map((field) => (
          <EditableStrategyField field={field} onChange={onFieldChange} key={field.id} />
        ))}
      </div>
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

export function EditableStrategyField({
  field,
  onChange,
}: {
  field: EditableField;
  onChange?: (fieldId: string, value: string) => void;
}) {
  return (
    <label className="editableField">
      <span>
        {field.label}
      </span>
      {field.input === "select" ? (
        <select
          value={field.value}
          disabled={!onChange}
          onChange={(event) => onChange?.(field.id, event.target.value)}
          aria-describedby={field.helperText ? `${field.id}-help` : undefined}
        >
          <option value="">Select</option>
          {field.options?.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.input ?? "text"}
          value={field.value}
          readOnly={!onChange}
          onChange={(event) => onChange?.(field.id, event.target.value)}
          aria-describedby={field.helperText ? `${field.id}-help` : undefined}
        />
      )}
      {field.helperText ? (
        <small id={`${field.id}-help`} className="muted">
          {field.helperText}
        </small>
      ) : null}
    </label>
  );
}

export function BacktestProgress() {
  return (
    <section className="backtestProgress" aria-live="polite" aria-labelledby="progress-title">
      <div className="backtestProgressCopy">
        <span className="backtestProgressIcon" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
            <path d="M3.5 14.5 7.4 10l3 2.4 5.8-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.7 5.4h3.5v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <h2 id="progress-title">Running backtest</h2>
          <p>Testing your strategy against historical data…</p>
        </div>
      </div>
      <div className="backtestProgressTrack" aria-hidden="true">
        <span />
      </div>
    </section>
  );
}

export function BacktestResults({ results }: { results: BacktestResultsView }) {
  return (
    <section className="backtestSummaries" aria-label="Backtest results">
      {results.results.map((result) => (
        <BacktestResultSummary
          result={result}
          strategySummary={results.strategySummary}
          generatedCode={results.generatedCode}
          warnings={results.warnings}
          key={result.ticker}
        />
      ))}
    </section>
  );
}

function BacktestResultSummary({
  result,
  strategySummary,
  generatedCode,
  warnings,
}: {
  result: TickerBacktestResult;
  strategySummary: string;
  generatedCode: string;
  warnings: string[];
}) {
  const totalReturn = result.headlineMetrics.find((metric) => metric.label === "Total return");
  const totalPnl = result.headlineMetrics.find((metric) => metric.label === "Total P&L");
  const tradesId = `backtest-trades-${result.ticker.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;

  return (
    <article className="backtestSummaryCard">
      <div className="backtestSummaryHeader">
        <div>
          <p>Backtest result</p>
          <h2>{result.ticker}</h2>
        </div>
        <span>{result.trades.length} trades</span>
      </div>
      <div className="backtestSummaryMetrics">
        <div className={totalReturn?.tone ?? "neutral"}>
          <span>Total return</span>
          <strong>{totalReturn?.value ?? "—"}</strong>
        </div>
        <div className={totalPnl?.tone ?? "neutral"}>
          <span>Total P&amp;L</span>
          <strong>{totalPnl?.value ?? "—"}</strong>
        </div>
      </div>
      <CompactEquityCurve points={result.equityCurve} ticker={result.ticker} />
      <Dialog.Root>
        <Dialog.Trigger className="resultDetailsButton">More details</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="resultsModalBackdrop" />
          <Dialog.Viewport className="resultsModalViewport">
            <Dialog.Popup className="resultsModalPopup">
              <header className="resultsModalHeader">
                <div>
                  <Dialog.Title>{result.ticker}</Dialog.Title>
                  <Dialog.Description className="resultsModalDescription">{strategySummary}</Dialog.Description>
                </div>
                <div className="resultsModalHeaderActions">
                  <a className="resultsModalTradesLink" href={`#${tradesId}`}>View all {result.trades.length} trades</a>
                  <Dialog.Close className="resultsModalClose" aria-label="Close backtest details">
                    <CloseIcon />
                  </Dialog.Close>
                </div>
              </header>
              <div className="resultsModalBody">
                <MetricsGrid metrics={result.headlineMetrics} featured />
                <MetricsGrid metrics={result.metrics} />
                <EquityCurve points={result.equityCurve} trades={result.trades} />
                {warnings.length > 0 ? (
                  <div className="warningList">
                    <strong>Disclosures</strong>
                    <ul>
                      {warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  </div>
                ) : null}
                <GeneratedCodeDrawer code={generatedCode} />
                <section id={tradesId} className="resultsModalTrades" aria-label={`All ${result.trades.length} ${result.ticker} trades`}>
                  <TradeTable trades={result.trades} />
                </section>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </article>
  );
}

function CompactEquityCurve({ points, ticker }: { points: EquityPoint[]; ticker: string }) {
  const chart = useMemo(() => buildChart(points, []), [points]);
  if (!chart) return <p className="compactChartEmpty">No equity curve is available.</p>;

  return (
    <figure className="compactChart">
      <svg viewBox="0 0 720 250" role="img" aria-label={`${ticker} account value over the backtest`} preserveAspectRatio="none">
        <line x1="56" x2="688" y1="230" y2="230" />
        <polyline points={chart.line} fill="none" />
      </svg>
      <figcaption>
        <span>{formatDateShort(points[0].date)}</span>
        <span>{formatDateShort(points[points.length - 1].date)}</span>
      </figcaption>
    </figure>
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
  const markerRadius = markerRadiusForCount(chart.markers.length);

  return (
    <figure className="chartFigure">
      <figcaption>Account equity</figcaption>
      <svg viewBox="0 0 720 300" role="img" aria-labelledby="equity-title equity-desc" preserveAspectRatio="xMidYMid meet">
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
          <circle
            className={marker.kind === "entry" ? "entryMarker" : "exitMarker"}
            cx={marker.x}
            cy={marker.y}
            r={markerRadius}
            key={`${marker.kind}-${marker.date}`}
          />
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

export function markerRadiusForCount(markerCount: number): number {
  if (markerCount > 120) return 2;
  if (markerCount > 60) return 3;
  if (markerCount > 24) return 4;
  return 5;
}

export function TradeTable({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return <p className="emptyState">No completed trades in this historical period.</p>;
  }

  return (
    <div className="tableScroller">
      <table>
        <caption>All {trades.length} trades</caption>
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
    </section>
  );
}

export function PanelIcon({ side }: { side: "left" | "right" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="none">
      <rect x="2.5" y="3" width="15" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d={side === "left" ? "M7 3.5v13" : "M13 3.5v13"} stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="none">
      <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
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
  return new Intl.DateTimeFormat("en-US", value.includes("T")
    ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }
    : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
  ).format(new Date(value));
}

function formatDateShort(value: string) {
  return new Intl.DateTimeFormat("en-US", value.includes("T")
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }
    : { month: "short", day: "numeric", timeZone: "UTC" }
  ).format(new Date(value));
}
