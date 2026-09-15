import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StrategyWorkbench } from "../components/strategy-workbench";
import { draftFromBacktestRequest } from "./conversation";
import { backtestRequestFixture } from "./fixtures";
import { mapDraftForDisplay } from "./presentation";

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
});

test("the new shell preserves draft editing and backtest actions", () => {
  const draft = mapDraftForDisplay(draftFromBacktestRequest(backtestRequestFixture), () => "proposed");
  const html = renderToStaticMarkup(
    createElement(StrategyWorkbench, {
      stage: "ready",
      idea: "",
      messages,
      draft,
      missingFields: [],
      hasProposals: true,
      onIdeaChange: () => undefined,
      onSubmitIdea: () => undefined,
      onNewStrategy: () => undefined,
      onFieldChange: () => undefined,
      onRunBacktest: () => undefined,
    }),
  );

  assert.match(html, /Strategy workspace/);
  assert.match(html, /Draft strategy/);
  assert.match(html, /Suggested values are highlighted/);
  assert.match(html, /Run historical paper backtest/);
});
