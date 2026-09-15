import assert from "node:assert/strict";
import test from "node:test";
import { createChatHandler } from "./chat-handler";
import {
  CHAT_HISTORY_MAX_CHARS,
  CHAT_HISTORY_MAX_MESSAGES,
  DEFAULT_CONFIRMED_FIELD_PATHS,
  conversationMessagesForRequest,
  draftFromBacktestRequest,
  populatedDraftPaths,
} from "./conversation";
import { backtestRequestFixture, hourlyBacktestRequestFixture } from "./fixtures";

function requestBody() {
  const strategyDraft = draftFromBacktestRequest(backtestRequestFixture);
  return {
    messages: [{ role: "user", content: "Use the details I supplied." }],
    strategy_draft: strategyDraft,
    confirmed_field_paths: populatedDraftPaths(strategyDraft),
  };
}

test("chat uses strict Responses API output and accepts a mocked structured turn", async () => {
  const body = requestBody();
  const turn = {
    assistant_message: "Your strategy is complete and ready for final confirmation.",
    strategy_draft: body.strategy_draft,
    missing_fields: [],
    confirmed_field_paths: body.confirmed_field_paths,
    proposed_field_paths: [],
    ready_for_confirmation: true,
  };
  let modelRequest: Record<string, unknown> | undefined;
  const client = {
    responses: {
      create: async (request: Record<string, unknown>) => {
        modelRequest = request;
        return { status: "completed", output: [], output_text: JSON.stringify(turn) };
      },
    },
  };
  const handler = createChatHandler(client, "test-model", "Test instructions");
  const response = await handler(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ready_for_confirmation, true);
  assert.equal(modelRequest?.model, "test-model");
  assert.deepEqual((modelRequest?.text as { format: unknown }).format, {
    type: "json_schema",
    name: "conversation_turn",
    strict: true,
    schema: (modelRequest?.text as { format: { schema: unknown } }).format.schema,
  });
  assert.equal(modelRequest?.store, false);
  assert.equal(modelRequest?.max_output_tokens, 8_000);
  assert.equal(modelRequest?.truncation, "disabled");
  const schema = (modelRequest?.text as { format: { schema: { properties: Record<string, { items: { enum: string[] } }> } } }).format.schema;
  assert.ok(schema.properties.confirmed_field_paths.items.enum.includes("backtest.start_date"));
  assert.ok(!schema.properties.confirmed_field_paths.items.enum.includes("strategy.backtest.start_date"));
  assert.ok(schema.properties.confirmed_field_paths.items.enum.includes("strategy.execution.holding_period_bars"));
});

test("chat accepts a structured version 1.2 strategy turn", async () => {
  const strategyDraft = draftFromBacktestRequest(hourlyBacktestRequestFixture);
  const confirmedFieldPaths = populatedDraftPaths(strategyDraft);
  const body = {
    messages: [{ role: "user" as const, content: "Use hourly SPY and QQQ signals." }],
    strategy_draft: strategyDraft,
    confirmed_field_paths: confirmedFieldPaths,
  };
  const client = {
    responses: {
      create: async () => ({
        status: "completed",
        output: [],
        output_text: JSON.stringify({
          assistant_message: "The hourly strategy is ready to test.",
          strategy_draft: strategyDraft,
          missing_fields: [],
          confirmed_field_paths: confirmedFieldPaths,
          proposed_field_paths: [],
          ready_for_confirmation: true,
        }),
      }),
    },
  };

  const response = await createChatHandler(client, "test-model", "instructions")(
    new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) }),
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.strategy_draft.strategy.version, "1.2");
  assert.equal(result.strategy_draft.strategy.execution.holding_period_bars, 14);
});

test("chat applies natural-language revisions to confirmed fields", async () => {
  const body = requestBody();
  const changedDraft = structuredClone(body.strategy_draft);
  changedDraft.strategy.name = "Lower-risk falling yields";
  const client = {
    responses: {
      create: async () => ({
        status: "completed",
        output: [],
        output_text: JSON.stringify({
          assistant_message: "I updated the strategy name based on your request.",
          strategy_draft: changedDraft,
          missing_fields: [],
          confirmed_field_paths: body.confirmed_field_paths,
          proposed_field_paths: [],
          ready_for_confirmation: true,
        }),
      }),
    },
  };
  const response = await createChatHandler(client, "test-model", "instructions")(
    new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) }),
  );
  const result = await response.json();
  assert.equal(result.strategy_draft.strategy.name, "Lower-risk falling yields");
  assert.ok(result.confirmed_field_paths.includes("strategy.name"));
});

test("chat retains unchanged confirmations and marks unconfirmed revisions as proposals", async () => {
  const body = requestBody();
  const changedDraft = structuredClone(body.strategy_draft);
  changedDraft.strategy.execution.allocation_percent = 10;
  const modelConfirmedPaths = body.confirmed_field_paths.filter(
    (path) => path !== "strategy.name" && path !== "strategy.execution.allocation_percent",
  );
  const client = {
    responses: {
      create: async () => ({
        status: "completed",
        output: [],
        output_text: JSON.stringify({
          assistant_message: "I assumed a lower allocation.",
          strategy_draft: changedDraft,
          missing_fields: [],
          confirmed_field_paths: modelConfirmedPaths,
          proposed_field_paths: ["strategy.execution.allocation_percent"],
          ready_for_confirmation: true,
        }),
      }),
    },
  };
  const response = await createChatHandler(client, "test-model", "instructions")(
    new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) }),
  );
  const result = await response.json();

  assert.ok(result.confirmed_field_paths.includes("strategy.name"));
  assert.ok(!result.confirmed_field_paths.includes("strategy.execution.allocation_percent"));
  assert.ok(result.proposed_field_paths.includes("strategy.execution.allocation_percent"));
});

test("chat returns safe errors for malformed, refused, and incomplete responses", async (context) => {
  const malformed = await createChatHandler(
    { responses: { create: async () => ({ status: "completed", output_text: "not json" }) } },
    "test-model",
    "instructions",
  )(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(requestBody()) }));
  assert.equal(malformed.status, 502);

  await context.test("refusal", async () => {
    const response = await createChatHandler(
      {
        responses: {
          create: async () => ({
            status: "completed",
            output: [{ type: "message", content: [{ type: "refusal", refusal: "No." }] }],
          }),
        },
      },
      "test-model",
      "instructions",
    )(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(requestBody()) }));
    assert.equal(response.status, 422);
  });

  await context.test("incomplete", async () => {
    const response = await createChatHandler(
      { responses: { create: async () => ({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }) } },
      "test-model",
      "instructions",
    )(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(requestBody()) }));
    assert.equal(response.status, 502);
  });
});

test("chat rejects malformed client input before a model call", async () => {
  let called = false;
  const handler = createChatHandler(
    { responses: { create: async () => { called = true; return {}; } } },
    "test-model",
    "instructions",
  );
  const response = await handler(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [], strategy_draft: {}, confirmed_field_paths: [] }),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.ok(DEFAULT_CONFIRMED_FIELD_PATHS.length > 0);
});

test("chat rejects oversized history before a model call", async () => {
  let called = false;
  const body = requestBody();
  body.messages = Array.from({ length: 9 }, () => ({ role: "user" as const, content: "x".repeat(4_000) }));
  const response = await createChatHandler(
    { responses: { create: async () => { called = true; return {}; } } },
    "test-model",
    "instructions",
  )(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) }));

  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("chat returns safe context and rate-limit errors", async (context) => {
  await context.test("context limit", async () => {
    const response = await createChatHandler(
      { responses: { create: async () => { throw { status: 400, code: "context_length_exceeded" }; } } },
      "test-model",
      "instructions",
    )(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(requestBody()) }));
    const result = await response.json();
    assert.equal(response.status, 413);
    assert.equal(result.error.code, "conversation_too_long");
  });

  await context.test("rate limit", async () => {
    const response = await createChatHandler(
      { responses: { create: async () => { throw { status: 429 }; } } },
      "test-model",
      "instructions",
    )(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(requestBody()) }));
    assert.equal(response.status, 429);
  });
});

test("conversation history keeps a bounded recent suffix", () => {
  const messages = Array.from({ length: CHAT_HISTORY_MAX_MESSAGES + 5 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `${index}:${"x".repeat(Math.floor(CHAT_HISTORY_MAX_CHARS / CHAT_HISTORY_MAX_MESSAGES))}`,
  }));
  const selected = conversationMessagesForRequest(messages);

  assert.ok(selected.length <= CHAT_HISTORY_MAX_MESSAGES);
  assert.ok(selected.reduce((count, message) => count + message.content.length, 0) <= CHAT_HISTORY_MAX_CHARS);
  assert.equal(selected.at(-1)?.content, messages.at(-1)?.content);
  assert.notEqual(selected.at(0)?.content, messages.at(0)?.content);
});
