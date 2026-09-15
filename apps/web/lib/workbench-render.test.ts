import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StrategyDetail, strategyRecordFromResponse } from "../components/strategy-detail";
import { strategies } from "../components/strategy-data";
import { StrategyWorkbench, markerRadiusForCount } from "../components/strategy-workbench";
import { draftFromBacktestRequest } from "./conversation";
import { backtestRequestFixture, backtestResponseFixture } from "./fixtures";
import { mapBacktestForDisplay, mapDraftForDisplay } from "./presentation";

const messages = [
  { id: "assistant-0", role: "assistant" as const, text: "Describe your trading idea." },
];

test("the empty state uses Sophia's new strategy workspace", () => {
  const html = renderToStaticMarkup(
    createElement(StrategyWorkbench, {
      stage: "empty",
      idea: "",
      messages,
      onIdeaChange: () => undefined,
      onSubmitIdea: () => undefined,
      onNewStrategy: () => undefined,
    }),
  );

  assert.match(html, /What would you like to test\?/);
  assert.match(html, /Past strategies/);
  assert.match(html, /New strategy/);
  assert.match(html, /uncle-trading-icon\.png/);
  assert.match(html, /chatComposer hasSuggestions/);
  assert.match(html, /rows="1"/);
  assert.match(html, /Buy Tesla after three down days/);
  assert.match(html, /Buy ADM after heavy Iowa rain/);
  assert.doesNotMatch(html, /Illustrative preview data/);
  assert.doesNotMatch(html, /paper-money simulations/);
  assert.match(html, /<span class="workspaceTitle"><\/span>/);
  assert.equal((html.match(/aria-label="Hide strategy history"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /aria-label="Show strategy history"/);
  assert.match(html, /role="separator"/);
  assert.match(html, /aria-label="Resize strategy history"/);
});

test("the new shell preserves draft editing and backtest actions", () => {
  const draft = mapDraftForDisplay(draftFromBacktestRequest(backtestRequestFixture), () => "proposed");
  const html = renderToStaticMarkup(
    createElement(StrategyWorkbench, {
      stage: "ready",
      idea: "",
      messages,
      draft,
      hasDraft: true,
      missingFields: [],
      onIdeaChange: () => undefined,
      onSubmitIdea: () => undefined,
      onNewStrategy: () => undefined,
      onFieldChange: () => undefined,
      onRunBacktest: () => undefined,
    }),
  );

  assert.match(html, /Strategy details/);
  assert.doesNotMatch(html, /Review and edit/);
  assert.equal((html.match(/aria-label="Hide strategy details"/g) ?? []).length, 1);
  assert.match(html, /Run backtest/);
  assert.match(html, />Deploy</);
  assert.doesNotMatch(html, /Proposed|Ready|In progress/);
  assert.equal((html.match(/aria-label="Hide strategy history"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /aria-label="Show strategy history"/);
});

test("chat loading appears as an assistant response", () => {
  const html = renderToStaticMarkup(
    createElement(StrategyWorkbench, {
      stage: "conversation",
      idea: "",
      messages,
      chatLoading: true,
      hasDraft: false,
      onIdeaChange: () => undefined,
      onSubmitIdea: () => undefined,
    }),
  );

  assert.match(html, /Uncle Trading is responding/);
  assert.match(html, />Send</);
  assert.doesNotMatch(html, /Sending…/);
});

test("backtest loading uses the compact chat design", () => {
  const html = renderToStaticMarkup(
    createElement(StrategyWorkbench, {
      stage: "loading",
      idea: "",
      messages,
      hasDraft: true,
      onIdeaChange: () => undefined,
      onSubmitIdea: () => undefined,
    }),
  );

  assert.match(html, /class="backtestProgress"/);
  assert.match(html, /Running backtest/);
  assert.doesNotMatch(html, /Running historical backtest|Generating checked strategy code|class="surface progressPanel"/);
});

test("completed backtests render a compact result with modal details", () => {
  const results = mapBacktestForDisplay(backtestResponseFixture);
  assert.ok(results);
  const html = renderToStaticMarkup(
    createElement(StrategyWorkbench, {
      stage: "complete",
      idea: "",
      messages,
      results,
      hasDraft: true,
      onIdeaChange: () => undefined,
      onSubmitIdea: () => undefined,
    }),
  );

  assert.match(html, /Backtest result/);
  assert.match(html, /Total P&amp;L/);
  assert.match(html, /More details/);
  assert.doesNotMatch(html, /Complete trade list/);
});

test("saved strategies use the redesigned backtest page", () => {
  const html = renderToStaticMarkup(createElement(StrategyDetail, { strategy: strategies[0] }));

  assert.match(html, /Back to strategies/);
  assert.match(html, /Past strategies/);
  assert.match(html, /Uncle Trading/);
  assert.match(html, /uncle-trading-icon\.png/);
  assert.match(html, /savedStrategyShell hasLeftSidebar/);
  assert.equal((html.match(/aria-label="Hide strategy history"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /aria-label="Show strategy history"/);
  assert.match(html, /P&amp;L over time/);
  assert.match(html, /Account value/);
  assert.doesNotMatch(html, /Paper strategy|Preview data/);
});

test("loaded backend results preserve the deployed strategy name", () => {
  assert.equal(backtestResponseFixture.status, "complete");
  if (backtestResponseFixture.status !== "complete") return;
  const saved = { ...strategies[0], name: "Tesla three-day dip" };

  const merged = strategyRecordFromResponse(saved, backtestResponseFixture);

  assert.equal(merged.name, "Tesla three-day dip");
  assert.notEqual(merged.name, "Loading strategy…");
});

test("equity markers shrink as trade density increases", () => {
  assert.equal(markerRadiusForCount(20), 5);
  assert.equal(markerRadiusForCount(50), 4);
  assert.equal(markerRadiusForCount(100), 3);
  assert.equal(markerRadiusForCount(134), 2);
});
