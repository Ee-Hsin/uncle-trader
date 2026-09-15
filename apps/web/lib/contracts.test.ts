import assert from "node:assert/strict";
import test from "node:test";
import { deployStrategy, runBacktest } from "./api-client";
import { isBacktestRequest, parseBacktestResponse, parseDeployResponse } from "./contracts";
import {
  DEFAULT_CONFIRMED_FIELD_PATHS,
  confirmationIssues,
  confirmedBacktestRequestFromDraft,
  createEmptyDraft,
  draftFromBacktestRequest,
  populatedDraftPaths,
} from "./conversation";
import {
  backtestErrorFixture,
  backtestRequestFixture,
  backtestResponseFixture,
  deployResponseFixture,
} from "./fixtures";
import { mapBacktestForDisplay, mapDeployForDisplay } from "./presentation";

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

test("the frozen request and response fixtures pass runtime validation", () => {
  assert.equal(isBacktestRequest(backtestRequestFixture), true);
  assert.equal(parseBacktestResponse(backtestResponseFixture).status, "complete");
  assert.equal(parseBacktestResponse(backtestErrorFixture).status, "error");
  assert.equal(parseDeployResponse(deployResponseFixture).status, "active");
});

test("missing and proposed values cannot produce a confirmed request", () => {
  const emptyIssues = confirmationIssues(createEmptyDraft(), DEFAULT_CONFIRMED_FIELD_PATHS);
  assert.ok(emptyIssues.missing.length > 0);

  const completeDraft = draftFromBacktestRequest(backtestRequestFixture);
  const proposedIssues = confirmationIssues(completeDraft, DEFAULT_CONFIRMED_FIELD_PATHS);
  assert.equal(proposedIssues.missing.length, 0);
  assert.ok(proposedIssues.proposed.length > 0);
  assert.throws(
    () => confirmedBacktestRequestFromDraft(completeDraft, DEFAULT_CONFIRMED_FIELD_PATHS),
    /proposed value/,
  );
});

test("a fully accepted draft creates the exact frozen request", () => {
  const draft = draftFromBacktestRequest(backtestRequestFixture);
  const acceptedPaths = populatedDraftPaths(draft);
  const issues = confirmationIssues(draft, acceptedPaths);
  assert.deepEqual(issues, { missing: [], proposed: [], contractError: null });
  assert.deepEqual(confirmedBacktestRequestFromDraft(draft, acceptedPaths), backtestRequestFixture);
});

test("backtest transport accepts complete and contract-shaped error responses", async () => {
  let sentBody: unknown;
  const completeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body));
    return jsonResponse(backtestResponseFixture);
  }) as typeof fetch;
  const complete = await runBacktest("http://api.test/", backtestRequestFixture, undefined, completeFetch);
  assert.equal(complete.status, "complete");
  assert.deepEqual(sentBody, backtestRequestFixture);

  const errorFetch = (async () => jsonResponse(backtestErrorFixture, 422)) as typeof fetch;
  const failure = await runBacktest("http://api.test", backtestRequestFixture, undefined, errorFetch);
  assert.equal(failure.status, "error");
});

test("deploy transport accepts active and contract-shaped error responses", async () => {
  const activeFetch = (async () => jsonResponse(deployResponseFixture)) as typeof fetch;
  const active = await deployStrategy("http://api.test", "fico-tnx-down-3d", undefined, activeFetch);
  assert.equal(active.status, "active");

  const errorBody = {
    status: "error",
    error: { code: "strategy_not_found", message: "The strategy was not found." },
  };
  const errorFetch = (async () => jsonResponse(errorBody, 404)) as typeof fetch;
  const failure = await deployStrategy("http://api.test", "missing", undefined, errorFetch);
  assert.equal(failure.status, "error");
});

test("contract responses map to the complete presentation shape", () => {
  const results = mapBacktestForDisplay(backtestResponseFixture);
  assert.ok(results);
  assert.equal(backtestResponseFixture.status, "complete");
  if (backtestResponseFixture.status !== "complete") return;
  assert.equal(results.strategyId, backtestResponseFixture.strategy_id);
  assert.equal(results.results.length, 1);
  assert.equal(results.results[0].equityCurve.length, backtestResponseFixture.results[0].equity_curve.length);
  assert.equal(results.results[0].trades.length, backtestResponseFixture.results[0].trades.length);
  assert.equal(results.results[0].headlineMetrics.length, 3);
  assert.equal(results.results[0].metrics.length, 6);

  const deploy = mapDeployForDisplay(deployResponseFixture, false, true);
  assert.equal(deploy.state, "active");
  assert.equal(deployResponseFixture.status, "active");
  if (deployResponseFixture.status !== "active") return;
  if (deploy.state === "active") assert.equal(deploy.strategyId, deployResponseFixture.strategy_id);
});
