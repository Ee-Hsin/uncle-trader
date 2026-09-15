# Uncle Trading Backend Task List

This checklist covers William's backend workstream only. All implementation and
test changes must remain inside `apps/api/**`. The contracts in `contracts/**`
are frozen and must not be edited by this workstream.

Tasks are ordered by dependency. Items within the same **parallel group** may be
worked on at the same time once their stated prerequisites are complete.

## 0. Repository and contract guardrails

- [x] Read `AGENTS.md` and the William backend workstream.
- [x] Read the backtest, confirmed-strategy, and deploy schemas and examples.
- [x] Confirm the existing worktree state before implementation.
- [x] Keep all backend-owned changes within `apps/api/**`.
- [x] Recheck `git status --short --branch` before every implementation phase.
- [ ] Stop and report the issue if the frozen contracts cannot support a required behavior.

## 1. Backend development environment

- [x] Add a backend Dockerfile.
- [x] Add Docker Compose for the FastAPI service.
- [x] Add a persistent Docker volume for the SQLite database file.
- [x] Add a container health check for `GET /health`.
- [x] Document local Docker usage and the fact that Docker configuration must be
  updated as dependencies, environment variables, ports, mounts, and startup
  behavior change.
- [x] Build the image and verify the container health endpoint.
- [x] Keep `Dockerfile`, `docker-compose.yml`, `.env.example`, and
  `requirements.txt` synchronized during every later phase.

## 2. Contract-exact models and API foundation

- [x] Replace the placeholder confirmed-strategy model with contract-exact models.
- [x] Replace the placeholder backtest request model with the contract shape.
- [x] Add complete and error backtest response variants.
- [x] Add active and error deployment response variants.
- [x] Forbid additional fields wherever the contracts do.
- [x] Validate real calendar dates and start date not being after end date.
- [x] Validate Yahoo and Open-Meteo source/field requirements.
- [x] Validate IANA timezone names.
- [x] Add user-safe contract error helpers.
- [x] Preserve the existing `GET /health` behavior.
- [x] Add small configurable CORS support for the local web origin.

## 3. Parallel group A: data adapters and persistence

Start after the contract models in section 2 are stable. The two subsections can
be implemented in parallel.

### A1. Yahoo Finance adapter

- [x] Add `yfinance` and its required runtime dependencies.
- [x] Load adjusted daily close and volume for target tickers.
- [x] Load a Yahoo signal symbol independently from target tickers.
- [x] Normalize dates, close values, and volume values.
- [x] Sort rows in ascending date order.
- [x] Handle ordinary and multi-index yfinance column layouts.
- [x] Reject empty frames, missing fields, null values, and unavailable symbols.

### A2. SQLite repository

- [x] Add SQLite schema initialization.
- [x] Read the database path from `API_DATABASE_PATH`.
- [x] Store the strategy ID, confirmed request, and backtest configuration.
- [x] Store generated source and the complete successful response.
- [x] Store status, UTC creation time, and UTC next-check time.
- [x] Add save and fetch operations.
- [x] Add an atomic activation operation.
- [x] Ensure database connections are closed and failures are user-safe.

## 4. Deterministic strategy and generated-source boundary

- [x] Add a deterministic fallback `Strategy` source for the demo path.
- [x] Require exactly one top-level class named `Strategy`.
- [x] Require `required_data()` and `generate_signals(data)`.
- [x] Reject imports and unexpected top-level execution.
- [x] Reject `open`, `eval`, `exec`, `compile`, and `__import__` access or calls.
- [x] Reject double-underscore names and attributes.
- [x] Compile source only after AST validation succeeds.
- [x] Run a normalized fixture in a separate process with a short timeout.
- [x] Validate required-data requests and returned signal dictionaries.
- [x] Return a contract-shaped rejection or timeout error.

## 5. Backtest engine and metrics

- [x] Accept only normalized signal and price rows.
- [x] Ensure generated strategies receive no provider clients or raw responses.
- [x] Enter at the next available trading-day close after a signal date.
- [x] Hold positions for the configured number of trading days.
- [x] Ignore overlapping signals while a position is open.
- [x] Allocate `allocation_percent` percentage points of available equity.
- [x] Run every target ticker independently with its own initial capital.
- [x] Implement long-position P&L.
- [x] Implement and document the simplified short-position P&L rule.
- [x] Produce the complete ordered trade list.
- [x] Produce a daily, ascending-date equity curve.
- [x] Calculate total P&L and total return percentage points.
- [x] Calculate annualized Sharpe from daily equity returns.
- [x] Return a null Sharpe for insufficient data or zero return variation.
- [x] Calculate average and expected P&L per trade.
- [x] Calculate win-rate percentage points.
- [x] Calculate non-positive maximum drawdown percentage points.
- [x] Calculate buy-and-hold return for the same ticker and period.
- [x] Define contract-valid zero-trade behavior without fabricated trades.

## 6. Parallel group B: Open-Meteo and API orchestration

Start after sections 2, 4, and 5 define stable interfaces. These subsections can
be implemented in parallel.

### B1. Open-Meteo adapter

- [x] Add a trusted backend HTTP client.
- [x] Request daily precipitation sum, maximum temperature, or minimum temperature.
- [x] Send the confirmed latitude, longitude, and timezone.
- [x] Normalize Open-Meteo dates and values into signal rows.
- [x] Sort rows in ascending date order.
- [x] Reject unsupported fields, invalid responses, mismatched arrays, null values,
  and empty series.

### B2. Backtest endpoint orchestration

- [x] Implement `POST /backtest` using the contract request model.
- [x] Generate or select an accepted strategy implementation.
- [x] Load all historical data through trusted adapters.
- [x] Run one independent backtest for each requested target ticker.
- [x] Ensure response tickers exactly match the request without duplicates.
- [x] Return no partial results if any required stage fails.
- [x] Add required paper-trading, fees/slippage, historical-results, and short-rule warnings.
- [x] Persist only a complete successful strategy and response.
- [x] Return the exact complete or error contract shape.

## 7. OpenAI strategy generation

Implementation is required, but automated OpenAI tests are intentionally out of
scope. Data and endpoint tests must not call or mock the OpenAI SDK.

- [x] Read `API_OPENAI_API_KEY` and `API_OPENAI_MODEL` without hardcoding either.
- [x] Use the server-side OpenAI Python SDK and Responses API.
- [x] Request Structured Output containing `code` and `explanation`.
- [x] Keep the runtime instruction aligned with the existing backend constraints.
- [x] Pass generated code through the same checker as the fallback strategy.
- [x] Use the deterministic fallback when configuration, generation, or validation fails.
- [x] Add a clear response warning when the fallback is used.
- [x] Ensure API keys cannot enter logs, exceptions, or responses.
- [ ] Perform only an optional manual OpenAI smoke check when credentials are available.

## 8. Simulated deployment

- [x] Implement `POST /strategies/{strategy_id}/deploy`.
- [x] Return `strategy_not_found` for an unknown ID.
- [x] Reject activation unless the saved strategy completed testing successfully.
- [x] Mark a valid saved strategy active.
- [x] Calculate and store the next daily check time in UTC.
- [x] Return the exact active deployment contract.
- [x] Do not create a scheduler or place real orders.

## 9. Automated tests

All provider data must be mocked locally. No automated test may call the network,
the OpenAI API, or the OpenAI SDK.

### 9.1 Contract and model tests

- [x] Validate the request example with Pydantic.
- [x] Validate complete and error backtest response examples.
- [x] Validate active and error deployment response examples.
- [x] Validate serialized fixtures against the frozen JSON Schemas.
- [x] Test invalid dates, date ordering, timezones, source/field combinations,
  duplicate tickers, and additional fields.

### 9.2 Mocked yfinance tests

- [x] Build realistic pandas DataFrames with a `DatetimeIndex` and yfinance-style
  `Close` and `Volume` columns.
- [x] Include a realistic multi-index column fixture.
- [x] Include weekends/trading-day gaps and timezone-aware index values.
- [x] Verify exact normalized price and signal rows.
- [x] Test empty frames, missing columns, null values, and provider exceptions.
- [x] Assert that no real yfinance network request occurs.

### 9.3 Mocked Open-Meteo tests

- [x] Build realistic JSON fixtures with `daily.time`,
  `daily.precipitation_sum`, `daily.temperature_2m_max`, and
  `daily.temperature_2m_min` arrays.
- [x] Include realistic latitude, longitude, timezone, and units metadata.
- [x] Verify exact normalized signal rows for every supported weather field.
- [x] Test mismatched array lengths, missing keys, null values, empty series, and
  HTTP/client failures.
- [x] Assert that no real Open-Meteo network request occurs.

### 9.4 Source-checker tests

- [x] Accept a valid import-free strategy fixture.
- [x] Reject imports, extra classes, top-level execution, dangerous calls, dunder
  access, syntax errors, invalid outputs, and timeouts.
- [x] Confirm the deterministic fallback passes the same checker.

### 9.5 Backtest and metric tests

- [x] Test no-look-ahead entry timing with hand-calculated rows.
- [x] Test trading-day holding periods and overlapping-signal handling.
- [x] Test independent multi-ticker capital and results.
- [x] Test long and short P&L.
- [x] Test null Sharpe, zero trades, drawdown, win rate, and buy-and-hold return.
- [x] Test ordered equity and trade dates.

### 9.6 Persistence and endpoint tests

- [x] Use a temporary SQLite database for every test.
- [x] Test save, fetch, restart persistence, and activation.
- [x] Test all required endpoints through FastAPI's test client.
- [x] Inject the deterministic local strategy so endpoint tests bypass OpenAI entirely.
- [x] Mock both historical-data adapters at their external boundaries.
- [x] Verify external failures return contract-shaped errors without partial results.
- [ ] Capture logs and responses to confirm no secret-like configuration is exposed.

## 10. Final verification and handoff

- [x] Run Python compilation for application and test modules.
- [x] Run the complete deterministic test suite.
- [x] Run JSON Schema fixture validation.
- [x] Run `docker compose config --quiet`.
- [x] Build the Docker image.
- [x] Start the Compose service and verify `GET /health`.
- [x] Stop the temporary verification service without deleting development data.
- [x] Confirm `git diff --check` passes.
- [x] Confirm every changed file is inside `apps/api/**`.
- [ ] Report exact files changed, checks passed, unavailable checks, known shortcuts,
  and frontend integration risks.
