"use client";

import { useMemo, useRef, useState } from "react";
import { StrategyWorkbench } from "@/components/strategy-workbench";
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
  proposedDraftPaths,
  updateDraftPath,
  type ConversationDraft,
  type ConversationMessage,
} from "@/lib/conversation";
import { fieldPathLabel, mapBacktestForDisplay, mapDeployForDisplay, mapDraftForDisplay } from "@/lib/presentation";

const NUMBER_PATHS = new Set([
  "strategy.signal.location.latitude",
  "strategy.signal.location.longitude",
  "strategy.signal.parameters.threshold",
  "strategy.signal.parameters.consecutive_observations",
  "strategy.signal.parameters.lookback_days",
  "strategy.signal.parameters.comparison_window_days",
  "strategy.execution.holding_period_days",
  "strategy.execution.allocation_percent",
  "backtest.initial_capital",
]);

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
  const [messages, setMessages] = useState<ConversationMessage[]>([
    {
      role: "assistant",
      content: "Describe one daily stock or ETF trading signal. I will ask for one missing decision at a time.",
    },
  ]);
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
  const chatSequence = useRef(0);
  const chatAbort = useRef<AbortController | null>(null);
  const backtestAbort = useRef<AbortController | null>(null);
  const deployAbort = useRef<AbortController | null>(null);
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

  const issues = useMemo(() => confirmationIssues(draft, confirmedPaths), [draft, confirmedPaths]);
  const proposedPaths = useMemo(() => proposedDraftPaths(draft, confirmedPaths), [draft, confirmedPaths]);
  const backtestView = useMemo(() => (backtest ? mapBacktestForDisplay(backtest) : null), [backtest]);

  function fieldState(path: string): FieldState {
    if (confirmedPaths.includes(path)) return "confirmed";
    if (proposedPaths.includes(path)) return "proposed";
    return "missing";
  }

  const draftView = useMemo(() => mapDraftForDisplay(draft, fieldState), [draft, confirmedPaths, proposedPaths]);
  const canConfirm = issues.missing.length === 0 && issues.proposed.length === 0 && !issues.contractError;
  const stage: WorkbenchStage = deploy?.status === "active"
    ? "active"
    : backtestLoading
      ? "loading"
      : backtestError
        ? "failure"
        : backtestView
          ? "complete"
          : confirmedRequest || canConfirm
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

  function editField(path: string, rawValue: string) {
    if (path === "strategy.signal.source") {
      editSource((rawValue || null) as SignalSource | null);
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

  function acceptProposals() {
    setConfirmedPaths((current) => [...new Set([...current, ...proposedPaths])]);
    invalidateConfirmation();
  }

  function confirmDraft() {
    try {
      setConfirmedRequest(confirmedBacktestRequestFromDraft(draft, confirmedPaths));
      setBacktestError(null);
    } catch (error) {
      setBacktestError(error instanceof Error ? error.message : "The draft is not valid.");
    }
  }

  async function startBacktest() {
    if (!confirmedRequest || backtestLoading) return;
    backtestAbort.current?.abort();
    deployAbort.current?.abort();
    const controller = new AbortController();
    backtestAbort.current = controller;
    setBacktestLoading(true);
    setBacktestError(null);
    setBacktest(null);
    setDeploy(null);
    try {
      const response = await runBacktest(apiBaseUrl, confirmedRequest, controller.signal);
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
      setDeploy(await deployStrategy(apiBaseUrl, backtestView.strategyId, controller.signal));
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
    <main>
      <StrategyWorkbench
        layout="workflow"
        stage={stage}
        messages={messages.map((message, index) => ({ id: `${message.role}-${index}`, role: message.role, text: message.content }))}
        idea={idea}
        draft={draftView}
        missingFields={issues.missing.map(fieldPathLabel)}
        results={backtestView ?? undefined}
        deploy={mapDeployForDisplay(deploy, deployLoading, Boolean(backtestView))}
        error={backtestError ? { title: "Backtest could not run", message: backtestError } : undefined}
        chatLoading={chatLoading}
        chatError={chatError ?? undefined}
        finalConfirmed={Boolean(confirmedRequest)}
        hasProposals={proposedPaths.length > 0}
        onIdeaChange={setIdea}
        onSubmitIdea={submitIdea}
        onFieldChange={editField}
        onAcceptProposals={acceptProposals}
        onConfirm={confirmDraft}
        onRunBacktest={startBacktest}
        onRetryBacktest={startBacktest}
        onDeploy={startDeploy}
      />
    </main>
  );
}
