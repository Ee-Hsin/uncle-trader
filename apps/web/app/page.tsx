"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StrategyWorkbench } from "@/components/strategy-workbench";
import { strategies } from "@/components/strategy-data";
import type { FieldState, WorkbenchStage } from "@/components/types";
import { deployStrategy, runBacktest } from "@/lib/api-client";
import type { BacktestRequest, BacktestResponse, DeployResponse, SignalSource } from "@/lib/contracts";
import {
  DEFAULT_CONFIRMED_FIELD_PATHS,
  CHAT_MESSAGE_MAX_CHARS,
  confirmedBacktestRequestFromDraft,
  confirmationIssues,
  conversationMessagesForRequest,
  createEmptyDraft,
  parseConversationTurn,
  populatedDraftPaths,
  proposedDraftPaths,
  updateDraftPath,
  type ConversationDraft,
  type ConversationMessage,
} from "@/lib/conversation";
import { fieldPathLabel, mapBacktestForDisplay, mapDeployForDisplay, mapDraftForDisplay } from "@/lib/presentation";
import {
  loadSavedStrategies,
  mergeSavedStrategies,
  storeSavedStrategies,
  strategyRecordFromDeployment,
  upsertSavedStrategy,
} from "@/lib/saved-strategies";

const NUMBER_PATHS = new Set([
  "strategy.signal.location.latitude",
  "strategy.signal.location.longitude",
  "strategy.signal.parameters.threshold",
  "strategy.signal.parameters.consecutive_observations",
  "strategy.signal.parameters.lookback_days",
  "strategy.signal.parameters.comparison_window_days",
  "strategy.execution.holding_period_days",
  "strategy.execution.holding_period_bars",
  "strategy.execution.allocation_percent",
  "backtest.initial_capital",
]);

const INITIAL_MESSAGE: ConversationMessage = {
  role: "assistant",
  content: "Describe a stock or ETF trading idea. I will fill in reasonable assumptions for you to review.",
};

function apiErrorMessage(body: unknown, fallback: string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return fallback;
}

export default function Home() {
  const [messages, setMessages] = useState<ConversationMessage[]>([INITIAL_MESSAGE]);
  const [idea, setIdea] = useState("");
  const [draft, setDraft] = useState<ConversationDraft>(createEmptyDraft);
  const [confirmedPaths, setConfirmedPaths] = useState<string[]>([...DEFAULT_CONFIRMED_FIELD_PATHS]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [confirmedRequest, setConfirmedRequest] = useState<BacktestRequest | null>(null);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [deploy, setDeploy] = useState<DeployResponse | null>(null);
  const [deployLoading, setDeployLoading] = useState(false);
  const [pastStrategies, setPastStrategies] = useState(strategies);
  const chatSequence = useRef(0);
  const chatAbort = useRef<AbortController | null>(null);
  const backtestAbort = useRef<AbortController | null>(null);
  const deployAbort = useRef<AbortController | null>(null);
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

  useEffect(() => {
    setPastStrategies(mergeSavedStrategies(loadSavedStrategies(window.localStorage), strategies));
  }, []);

  const issues = useMemo(() => confirmationIssues(draft, confirmedPaths), [draft, confirmedPaths]);
  const proposedPaths = useMemo(() => proposedDraftPaths(draft, confirmedPaths), [draft, confirmedPaths]);
  const backtestView = useMemo(() => (backtest ? mapBacktestForDisplay(backtest) : null), [backtest]);
  const readyRequest = useMemo(() => {
    if (issues.missing.length > 0 || issues.contractError) return null;
    try {
      return confirmedBacktestRequestFromDraft(draft, populatedDraftPaths(draft));
    } catch {
      return null;
    }
  }, [draft, issues.contractError, issues.missing.length]);

  function fieldState(path: string): FieldState {
    if (confirmedPaths.includes(path)) return "confirmed";
    if (proposedPaths.includes(path)) return "proposed";
    return "missing";
  }

  const draftView = useMemo(() => mapDraftForDisplay(draft, fieldState), [draft, confirmedPaths, proposedPaths]);
  const stage: WorkbenchStage = deploy?.status === "active"
    ? "active"
    : backtestLoading
      ? "loading"
      : chatLoading
        ? "conversation"
      : backtestError
        ? "failure"
        : backtestView
          ? "complete"
          : readyRequest
            ? "ready"
            : proposedPaths.length > 0
              ? "proposed"
              : messages.length > 1
                ? "missing"
                : "empty";

  function cancelInFlightWork() {
    backtestAbort.current?.abort();
    deployAbort.current?.abort();
    setBacktestLoading(false);
    setDeployLoading(false);
  }

  function invalidateConfirmation() {
    cancelInFlightWork();
    setConfirmedRequest(null);
    setBacktest(null);
    setBacktestError(null);
    setDeploy(null);
  }

  function startNewStrategy() {
    chatAbort.current?.abort();
    chatSequence.current += 1;
    cancelInFlightWork();
    setMessages([INITIAL_MESSAGE]);
    setIdea("");
    setDraft(createEmptyDraft());
    setConfirmedPaths([...DEFAULT_CONFIRMED_FIELD_PATHS]);
    setChatLoading(false);
    setChatError(null);
    setConfirmedRequest(null);
    setBacktest(null);
    setBacktestError(null);
    setDeploy(null);
  }

  function recordEdit(path: string, value: unknown) {
    setDraft((current) => {
      let next = current;
      if (path.startsWith("strategy.signal.location.") && current.strategy.signal.location === null) {
        next = updateDraftPath(next, "strategy.signal.location", {
          name: null,
          latitude: null,
          longitude: null,
          timezone: null,
        });
      }
      return updateDraftPath(next, path, value);
    });
    setConfirmedPaths((current) => {
      const next = new Set(current);
      if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) next.delete(path);
      else next.add(path);
      return [...next];
    });
    chatAbort.current?.abort();
    chatSequence.current += 1;
    setChatLoading(false);
    setChatError(null);
    invalidateConfirmation();
  }

  function editSource(source: SignalSource | null) {
    setDraft((current) => {
      let next = updateDraftPath(current, "strategy.signal.source", source);
      next = updateDraftPath(next, "strategy.signal.field", null);
      next = updateDraftPath(next, "strategy.signal.symbol", null);
      return updateDraftPath(next, "strategy.signal.location", null);
    });
    setConfirmedPaths((current) => {
      const next = new Set(current);
      for (const path of [
        "strategy.signal.source",
        "strategy.signal.field",
        "strategy.signal.symbol",
        "strategy.signal.location.name",
        "strategy.signal.location.latitude",
        "strategy.signal.location.longitude",
        "strategy.signal.location.timezone",
      ]) {
        next.delete(path);
      }
      if (source) next.add("strategy.signal.source");
      return [...next];
    });
    chatAbort.current?.abort();
    chatSequence.current += 1;
    setChatLoading(false);
    setChatError(null);
    invalidateConfirmation();
  }

  function editVersion(version: ConversationDraft["strategy"]["version"]) {
    setDraft((current) => {
      let next = updateDraftPath(current, "strategy.version", version);
      const intraday = version === "1.2";
      const multiSource = intraday || version === "1.1";
      next = updateDraftPath(next, "strategy.signal.source", null);
      next = updateDraftPath(next, "strategy.signal.symbol", null);
      next = updateDraftPath(next, "strategy.signal.field", null);
      next = updateDraftPath(next, "strategy.signal.location", null);
      next = updateDraftPath(next, "strategy.signal.sources", multiSource ? current.strategy.signal.sources : null);
      next = updateDraftPath(next, "strategy.signal.parameters.observation_frequency", intraday ? "hourly" : "daily");
      next = updateDraftPath(next, "strategy.execution.entry_timing", intraday ? "next_trading_bar_close" : "next_trading_day_close");
      next = updateDraftPath(next, "strategy.execution.holding_period_days", intraday ? null : current.strategy.execution.holding_period_days);
      next = updateDraftPath(next, "strategy.execution.bar_interval", intraday ? "1h" : null);
      next = updateDraftPath(next, "strategy.execution.session", intraday ? "regular" : null);
      return updateDraftPath(next, "strategy.execution.holding_period_bars", intraday ? current.strategy.execution.holding_period_bars : null);
    });
    setConfirmedPaths((current) => {
      const next = new Set(current.filter((path) =>
        !path.startsWith("strategy.signal.") &&
        !path.startsWith("strategy.execution.") &&
        path !== "strategy.version"
      ));
      if (version) next.add("strategy.version");
      next.add("strategy.execution.entry_timing");
      next.add("strategy.execution.ignore_overlapping_signals");
      next.add("strategy.signal.parameters.observation_frequency");
      if (version === "1.2") {
        next.add("strategy.execution.bar_interval");
        next.add("strategy.execution.session");
      }
      return [...next];
    });
    chatAbort.current?.abort();
    chatSequence.current += 1;
    setChatLoading(false);
    setChatError(null);
    invalidateConfirmation();
  }

  function editField(path: string, rawValue: string) {
    if (path === "strategy.version") {
      editVersion((rawValue || null) as ConversationDraft["strategy"]["version"]);
      return;
    }
    if (path === "strategy.signal.source") {
      editSource((rawValue || null) as SignalSource | null);
      return;
    }
    if (path === "strategy.signal.sources") {
      recordEdit(path, parseSignalSources(rawValue));
      return;
    }
    if (path === "strategy.target_tickers") {
      recordEdit(
        path,
        rawValue.trim()
          ? rawValue.split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)
          : null,
      );
      return;
    }
    if (NUMBER_PATHS.has(path)) {
      recordEdit(path, rawValue === "" ? null : Number(rawValue));
      return;
    }
    recordEdit(path, rawValue || null);
  }

  async function submitIdea(override?: string) {
    const content = (override ?? idea).trim();
    if (!content || chatLoading) return;
    if (content.length > CHAT_MESSAGE_MAX_CHARS) {
      setChatError(`Keep each message under ${CHAT_MESSAGE_MAX_CHARS.toLocaleString()} characters.`);
      return;
    }
    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setIdea("");
    setChatError(null);
    setChatLoading(true);
    invalidateConfirmation();
    chatAbort.current?.abort();
    const controller = new AbortController();
    chatAbort.current = controller;
    const sequence = ++chatSequence.current;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: conversationMessagesForRequest(nextMessages),
          strategy_draft: draft,
          confirmed_field_paths: confirmedPaths,
        }),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(body, "The conversation service failed."));
      const turn = parseConversationTurn(body);
      if (sequence !== chatSequence.current) return;
      setDraft(turn.strategy_draft);
      setConfirmedPaths(turn.confirmed_field_paths);
      setMessages((current) => [...current, { role: "assistant", content: turn.assistant_message }]);
    } catch (error) {
      if (!controller.signal.aborted) {
        setChatError(error instanceof Error ? error.message : "The conversation service failed.");
      }
    } finally {
      if (sequence === chatSequence.current) setChatLoading(false);
    }
  }

  async function startBacktest() {
    const request = confirmedRequest ?? readyRequest;
    if (!request || backtestLoading) return;
    if (!confirmedRequest) {
      setConfirmedPaths(populatedDraftPaths(draft));
      setConfirmedRequest(request);
    }
    backtestAbort.current?.abort();
    deployAbort.current?.abort();
    const controller = new AbortController();
    backtestAbort.current = controller;
    setBacktestLoading(true);
    setBacktestError(null);
    setBacktest(null);
    setDeploy(null);
    try {
      const response = await runBacktest(apiBaseUrl, request, controller.signal);
      setBacktest(response);
      if (response.status === "error") setBacktestError(response.error.message);
    } catch (error) {
      if (!controller.signal.aborted) setBacktestError(error instanceof Error ? error.message : "The backtest failed.");
    } finally {
      if (!controller.signal.aborted) setBacktestLoading(false);
    }
  }

  async function startDeploy() {
    if (!backtestView || deployLoading) return;
    deployAbort.current?.abort();
    const controller = new AbortController();
    deployAbort.current = controller;
    setDeployLoading(true);
    try {
      const response = await deployStrategy(apiBaseUrl, backtestView.strategyId, controller.signal);
      setDeploy(response);
      if (response.status === "active" && backtest?.status === "complete") {
        const request = confirmedRequest ?? readyRequest;
        if (request) {
          const savedStrategy = strategyRecordFromDeployment(request, backtest);
          setPastStrategies((current) => {
            const next = upsertSavedStrategy(current, savedStrategy);
            storeSavedStrategies(window.localStorage, next);
            return next;
          });
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setDeploy({
          status: "error",
          error: {
            code: "backtest_failed",
            message: error instanceof Error ? error.message : "Deployment failed.",
          },
        });
      }
    } finally {
      if (!controller.signal.aborted) setDeployLoading(false);
    }
  }

  return (
    <main className="strategyAppRoot">
      <StrategyWorkbench
        stage={stage}
        messages={messages.map((message, index) => ({ id: `${message.role}-${index}`, role: message.role, text: message.content }))}
        idea={idea}
        draft={draftView}
        missingFields={[
          ...issues.missing.map(fieldPathLabel),
          ...(issues.contractError ? [issues.contractError] : []),
        ]}
        results={backtestView ?? undefined}
        deploy={mapDeployForDisplay(deploy, deployLoading, Boolean(backtestView))}
        error={backtestError ? { title: "Backtest could not run", message: backtestError } : undefined}
        chatLoading={chatLoading}
        chatError={chatError ?? undefined}
        hasDraft={Boolean(
          draft.strategy.name ||
          draft.strategy.target_tickers ||
          draft.strategy.signal.source ||
          draft.strategy.signal.sources?.length ||
          draft.strategy.signal.rule
        )}
        pastStrategies={pastStrategies}
        onIdeaChange={setIdea}
        onSubmitIdea={submitIdea}
        onNewStrategy={startNewStrategy}
        onFieldChange={editField}
        onRunBacktest={startBacktest}
        onDeploy={startDeploy}
      />
    </main>
  );
}

function parseSignalSources(value: string): ConversationDraft["strategy"]["signal"]["sources"] {
  const entries = value.split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return null;
  return entries.map((entry, index) => {
    const separator = entry.indexOf(":");
    const prefix = separator >= 0 ? entry.slice(0, separator) : "";
    const rest = separator >= 0 ? entry.slice(separator + 1) : entry;
    const parts = rest.trim().split(/\s+/);
    const provider = parts[0] ?? "";
    const field = parts[1] ?? "";
    const keyBase = prefix || (provider.toLowerCase() === "bls" ? field : provider) || `signal_${index + 1}`;
    const key = keyBase.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "").slice(0, 32) || `signal_${index + 1}`;
    const isBls = provider.toLowerCase() === "bls" || ["cpi", "inflation_yoy_percent", "unemployment_rate_percent"].includes(provider);
    return {
      key,
      source: isBls ? "bls" : "yahoo",
      symbol: isBls ? null : provider.toUpperCase(),
      field: (isBls ? (provider.toLowerCase() === "bls" ? field : provider) : field) as NonNullable<ConversationDraft["strategy"]["signal"]["sources"]>[number]["field"],
    };
  });
}
