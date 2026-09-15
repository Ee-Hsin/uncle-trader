# Jordan agent and integration workstream prompt

You are implementing the conversation agent and integration workstream for the Uncle Trading three-hour hackathon MVP. Work in the existing repository checkout. Before you edit anything:

1. Run `git status --short --branch` and preserve every existing change.
2. Read `AGENTS.md`.
3. Read `contracts/README.md`, all four schemas, and all contract examples.
4. Inspect the current web page, chat route, prompt files, and package conventions.

Your ownership is limited to:

- `apps/web/app/api/chat/**`
- `apps/web/lib/**`
- `apps/web/app/page.tsx`
- `prompts/**`
- `contracts/**` only as contract steward
- root web dependency and environment files when required for this workstream

Do not edit `apps/api/**`, `apps/web/components/**`, `apps/web/app/globals.css`, or `apps/web/app/ui-preview/**`. Do not redesign Sophia's components or CSS. Preserve every existing change. Do not commit, push, create a branch, create a worktree, or discard changes unless the human explicitly asks.

The contracts are already fixed. Do not replace or independently change them. Build exact TypeScript types that mirror their field names, nesting, unions, null values, percentage units, and success/error response shapes. If a contract inconsistency appears, stop and report it before changing any schema or example.

## Product flow

Implement this flow:

1. The user enters a vague trading idea.
2. The conversation agent extracts confirmed facts and makes clearly labeled proposals.
3. It asks one focused question for the most important missing or unclear value.
4. The draft shows each value as missing, proposed, or confirmed.
5. The user can directly edit draft values.
6. The user gives final confirmation.
7. The web app sends a contract-valid body to FastAPI `POST /backtest`.
8. The page maps the backtest response into Sophia's presentational component props.
9. The user can call `POST /strategies/{strategy_id}/deploy` and see active status and the next check time.

FastAPI receives only the final confirmed backtest request. Never send the conversation transcript to FastAPI.

## Exact web contract types

Create a small `apps/web/lib` contract layer that mirrors:

- `contracts/confirmed-strategy.schema.json`
- `contracts/backtest-request.schema.json`
- `contracts/backtest-response.schema.json`
- `contracts/deploy-response.schema.json`

Keep API transport and formatting helpers separate from UI state where practical. Do not add web fields to backend payloads. Treat all `_percent` values as percentage points. Treat each target ticker result as an independent backtest.

## Conversation route

Replace the placeholder `POST /api/chat` route. Use the official server-side OpenAI JavaScript SDK and the Responses API. Follow the official [Responses API guidance](https://developers.openai.com/api/docs/guides/migrate-to-responses) and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

Use strict JSON Schema Structured Outputs under the Responses API `text.format` configuration. Do not ask for free-form JSON and then call `JSON.parse` on assumed model text. Handle refusals, incomplete responses, configuration errors, and malformed inputs with safe server responses.

Read these variables only on the server:

- `WEB_OPENAI_API_KEY`
- `WEB_OPENAI_MODEL`

Do not hardcode a model name. Never expose the key through a client bundle, response, or log.

The chat route request must contain:

- the conversation messages needed for the current turn;
- the current strategy and backtest draft;
- a list of confirmed field paths.

The model's structured turn response must contain:

- `assistant_message`: plain language shown to the user;
- `strategy_draft`: the current partial draft;
- `missing_fields`: contract field paths that still need user input;
- `ready_for_confirmation`: a boolean that is true only when every required field is complete.

Use one local JSON Schema for this conversation-turn response. Make its objects strict and its states explicit. It can represent a partial draft, but the final backtest request must validate against the frozen API request contract.

## Conversation behavior

Put the actual runtime instructions in `prompts/conversation-agent.md`; the route should load or import stable instruction content from a server-only location. The runtime instructions must enforce these rules:

- Preserve confirmed values unless the user explicitly changes them.
- Never silently invent a ticker, weather location, threshold, holding period, allocation, start date, or end date.
- Label suggested values as proposals until the user accepts or edits them.
- Ask about choices that materially change the strategy meaning.
- Ask only one concise missing-information question per turn.
- Use plain language suitable for a nontechnical user.
- Do not claim that historical results prove a strategy is good or will make money.
- Keep the MVP on daily observations, next-trading-day-close entry, one explicit entry condition, and one fixed holding period.
- Reject unsupported markets, unavailable signal fields, intraday strategies, options, leveraged portfolios, and requests outside the frozen contract.
- Set `ready_for_confirmation` only when all required strategy and backtest fields are complete and internally coherent.

`prompts/strategy-codegen.md` documents the backend runtime prompt. Keep it aligned with the rule that generated source contains exactly one import-free `Strategy` class with `required_data()` and `generate_signals(data)`. Do not edit William-owned backend code.

## Page state and integration

Own the state and network integration in `apps/web/app/page.tsx` and `apps/web/lib/**`. Do not move this logic into Sophia's presentational components.

Support:

- chat submission and conversation history;
- current draft state;
- missing, proposed, and confirmed field state;
- direct field edits;
- explicit final confirmation;
- a disabled backtest action until final confirmation;
- `POST /backtest` through `NEXT_PUBLIC_API_BASE_URL`;
- loading and contract-shaped failure states;
- mapping success and error data into Sophia's UI-only props;
- `POST /strategies/{strategy_id}/deploy`;
- active state and formatted next-check time.

Do not expose server AI variables in client code. `NEXT_PUBLIC_API_BASE_URL` is the only public integration variable. Keep request cancellation and stale-response handling simple but safe.

## Delivery order

Use this order:

1. Add exact TypeScript contract types and fixture parsing.
2. Make the page work against contract-shaped local fixtures and Sophia's prop types.
3. Implement draft, edit, confirmation, loading, and failure state.
4. Implement `/api/chat` with Responses API Structured Outputs.
5. Connect live `/backtest` and deploy calls.
6. Tighten prompt behavior and error handling.

Stop optional work when the core path works. Do not add a state library, form library, chart library, or design dependency unless the existing project already uses it and it is necessary.

## Verification and finish criteria

Follow existing frontend test conventions. Do not introduce a UI test framework if none exists. Add small pure logic tests only if the current test tools support them.

At minimum:

- type-check exact request and response fixtures;
- verify the final payload matches the frozen request contract;
- verify missing and proposed values cannot start a backtest;
- smoke-test the chat route with the OpenAI call mocked;
- exercise complete and error backtest responses;
- exercise active and error deploy responses;
- run `npm run typecheck:web`;
- run `npm run build:web`.

Finish when a vague idea can become a clearly confirmed request, the model response is constrained by JSON Schema Structured Outputs, no key reaches the browser, the live API response maps into Sophia's props, deploy state works, and the web type check and build pass.

Report the exact files changed, checks that passed, checks that could not run, model calls that were mocked, and integration risks. Do not commit unless the human asks.

