# William backend workstream prompt

You are implementing the backend workstream for the Uncle Trading three-hour hackathon MVP. Work in the existing repository checkout. Before you edit anything:

1. Run `git status --short --branch` and preserve every existing change.
2. Read `AGENTS.md`.
3. Read `contracts/README.md`, `contracts/backtest-request.schema.json`, `contracts/backtest-response.schema.json`, `contracts/deploy-response.schema.json`, and all related examples.
4. Inspect the current `apps/api` structure and follow its conventions.

Your ownership is `apps/api/**` only. Do not edit the web app, contracts, prompts, root files, package files, or another owner's paths. The contracts are frozen. If a schema is inconsistent or cannot support the implementation, stop and report the exact problem. Do not rename, add, remove, or move contract fields. Do not commit, push, create a branch, create a worktree, or discard changes unless the human explicitly asks.

## Product outcome

Build the FastAPI path that accepts a confirmed structured strategy, asks an OpenAI model to generate one constrained Python `Strategy` class, checks the source, loads historical daily data through trusted clients, backtests each target ticker independently, saves the strategy and result, and simulates activation.

This is a paper-trading hackathon demo. Do not add real orders, brokerage connections, a scheduler, authentication, Docker, or production infrastructure.

## Required routes and models

Implement:

- `GET /health`
- `POST /backtest`
- `POST /strategies/{strategy_id}/deploy`

Add `GET /strategies/{strategy_id}` only if the core path is complete and it helps integration.

Pydantic request and response models must exactly match:

- `contracts/backtest-request.schema.json`
- `contracts/backtest-response.schema.json`
- `contracts/deploy-response.schema.json`

Use the examples as fixtures. Keep backtest settings outside the confirmed strategy. Return errors with the contract error codes and user-safe messages. Never return partial or invented results after a failure.

## OpenAI code generation

Use the server-side OpenAI Python SDK and the Responses API. Follow the official [Responses API guidance](https://developers.openai.com/api/docs/guides/migrate-to-responses) and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs). Ask the model for a structured object containing `code` and `explanation`; do not parse an assumed free-form JSON block.

Read these environment variables:

- `API_OPENAI_API_KEY`
- `API_OPENAI_MODEL`

Do not hardcode a model name. Fail clearly when required configuration is missing. Never return, print, or log an API key.

Put the runtime code-generation instruction in backend-owned code. Keep it aligned with `prompts/strategy-codegen.md`, but do not edit that Jordan-owned file.

## Generated strategy boundary

Accepted generated source must contain exactly one top-level class named `Strategy` with:

- `required_data()` returning a list of data-request dictionaries
- `generate_signals(data)` returning signal dictionaries

The generated file must have no imports, file access, network access, model calls, data fetching, backtest code, or metric calculations. It may use only built-in Python operations on normalized rows supplied by the backend.

Build an AST checker that:

- requires exactly one top-level `Strategy` class;
- requires both methods;
- rejects all imports and unexpected top-level execution;
- rejects calls or access to `open`, `eval`, `exec`, `compile`, and `__import__`;
- rejects double-underscore names and attributes;
- compiles the source after AST checks;
- runs a small normalized fixture check in an isolated process with a short timeout;
- returns clear contract-shaped errors for rejection or timeout.

Do not treat AST checks alone as a complete production sandbox. Keep the allowed behavior small.

## Trusted historical data

All data loading stays in trusted backend code.

- Use `yfinance` for adjusted daily close and volume for US stocks, ETFs, and yield symbols such as `^TNX`.
- Use the Open-Meteo historical HTTP API for daily precipitation sum, maximum temperature, and minimum temperature.
- Normalize dates and values before generated code sees them.

Supply generated strategies with this logical structure:

- `data["signal"]`: a list of `{ "date": "YYYY-MM-DD", "value": number }` rows in ascending date order.
- `data["prices"]`: a mapping from each target ticker to a list of `{ "date": "YYYY-MM-DD", "close": number, "volume": number }` rows in ascending date order.

Validate requested fields, locations, dates, empty series, and missing values. A Yahoo signal symbol can differ from the target ticker.

## Backtest rules

Use only data known through the signal date. Do not introduce look-ahead bias.

- Test each `target_tickers` item independently with its own starting capital. Do not combine them as a portfolio.
- Enter at the next available US trading-day close after the signal date.
- Hold for the fixed number of trading days in `holding_period_days` and exit at the close.
- Ignore overlapping signals while the same independent backtest has an open position.
- Allocate `allocation_percent` percentage points of available equity.
- Use paper money, no leverage, no fees, and no slippage.
- Model short positions with a clear simplified P&L rule and disclose that simplification in warnings.

Calculate every metric named in the response schema:

- total P&L and total return percentage points;
- annualized Sharpe ratio from daily equity returns, `sqrt(252) * mean / sample standard deviation`, with a zero risk-free rate;
- average P&L per trade;
- expected value per trade;
- win-rate percentage points;
- maximum drawdown as a non-positive percentage-point value;
- trade count;
- buy-and-hold return percentage points for the same ticker and period;
- the daily equity curve;
- the complete trade list.

Return `sharpe_ratio: null` when there are too few daily returns or their variation is zero. Keep all percentage fields in percentage points, as required by the contracts.

## Persistence and activation

Use local SQLite. Save enough data to reproduce and display a strategy:

- strategy ID;
- confirmed request and backtest configuration;
- generated source;
- complete response or result;
- status;
- creation time in UTC;
- next-check time in UTC.

Deploy only a saved, successfully tested strategy. Simulated deployment marks it active and returns the next daily check time through the deploy-response contract. Do not create a scheduler or place orders.

Allow the local web origin through a small configurable CORS setup.

## Delivery order

Use this order and stop optional work when time is short:

1. Return a contract-valid fixture response from `/backtest`.
2. Implement Yahoo loading and correct metrics.
3. Add Responses API code generation.
4. Add the generated-source checker and timed fixture run.
5. Add SQLite persistence.
6. Add Open-Meteo loading.
7. Add simulated deploy.

Keep a deterministic fallback strategy for the demo path if the model is unavailable or its output is rejected. The fallback must pass the same checker, use the same normalized input, and return the same contract response shape. Add a clear warning when the fallback is used. Do not conceal a failure behind invented metrics.

## Verification and finish criteria

Use existing backend test conventions. If none exist, add focused logic tests using the current Python test tools without building a large test framework. At minimum, cover:

- Pydantic acceptance of the request example and both response variants;
- valid and rejected generated-source fixtures;
- no look-ahead entry timing and overlapping-signal handling;
- independent target ticker runs;
- metric edge cases, including null Sharpe and zero trades;
- SQLite save, fetch, and activation;
- endpoint smoke tests with external OpenAI and data calls mocked.

Run Python compilation, the focused tests, and endpoint smoke tests. Validate returned fixtures against the JSON Schemas when practical. Finish when the three required routes work, every payload matches the frozen contracts, external failures return contract-shaped errors, and no secret can reach logs or responses.

Report the exact files changed, checks that passed, checks that could not run, known shortcuts, and integration notes. Do not commit unless the human asks.
