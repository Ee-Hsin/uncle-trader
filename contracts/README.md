# API contracts

The JSON Schemas in this directory are the exact source of truth for API field names, nesting, types, allowed values, and response shapes. Frontend TypeScript types and backend Pydantic models must match them.

No frontend or backend agent may rename, add, remove, or move contract fields independently. A contract change must update the affected schemas and examples together.

## Shared rules

- Schemas use JSON Schema draft 2020-12 and portable relative references.
- Dates use `YYYY-MM-DD`.
- Times use ISO 8601 UTC.
- Fields ending in `_percent` use percentage points. For example, `12.4` means 12.4%, not 0.124.
- Multiple `target_tickers` are backtested independently. They do not form a combined portfolio.
- Backtest configuration is outside `strategy` because it controls one test run, not the deployed trading rule.
- A successful result item must use one requested target ticker. The API must return one independent result for each requested target ticker.
- A `null` Sharpe ratio means there is not enough data to calculate it.
- Error responses contain no partial or fabricated results. A backtest error still contains `generated_code`; it can be an empty string when no code is safe or available to return.

## Files

- `confirmed-strategy.schema.json`: the confirmed strategy shared by the conversation and backtest services.
- `backtest-request.schema.json`: the request body for `POST /backtest`.
- `backtest-response.schema.json`: the complete or error response from `POST /backtest`.
- `deploy-response.schema.json`: the active or error response from `POST /strategies/{strategy_id}/deploy`.
- Files ending in `.example.json` are examples only. Their prices, metrics, dates, and generated code are illustrative and are not verified market results.

## Validation limits

JSON Schema validates the wire format, but application logic must also verify that the backtest start date is not after its end date, dates exist on the calendar, timezone names exist in the IANA database, response tickers exactly match the requested tickers without duplicates, equity and trade dates are ordered, metrics agree with the underlying series, and generated Python is safe. The schemas do not claim that a ticker exists or that market data is available.

The current placeholder code in `apps/web` and `apps/api` predates these contracts and is temporarily out of sync. Update those implementations against these schemas before connecting the frontend to the backend.

