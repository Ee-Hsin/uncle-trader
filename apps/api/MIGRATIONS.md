# Pending API Contract Migrations

This file records backend previews that require coordinated updates to the frozen
contracts and frontend before they become part of the shared public API. It does
not replace `contracts/**`, which remains the source of truth.

## Confirmed strategy 1.1: multiple Yahoo signal sources

Status: **implemented as a backward-compatible backend preview; contract and
frontend adoption are pending.**

The existing version 1.0 request remains accepted without any field or behavior
changes. Version 1.1 adds complex conditions backed by multiple Yahoo Finance
series while restricting the strategy to one traded ticker.

### Contract changes requiring Jordan's approval

- Change `strategy.version` from the constant `"1.0"` to versioned alternatives
  that preserve the complete 1.0 shape and add a 1.1 shape.
- For version 1.1, require exactly one `target_tickers` item.
- Keep the outer `signal` field, its `rule`, and its `parameters`.
- Replace the version 1.0 signal's single `source`, `symbol`, and `field` with a
  version 1.1 `sources` array containing 2–10 entries.
- Each version 1.1 source has exactly `key`, `source`, `symbol`, and `field`.
- Require `key` to match `^[a-z][a-z0-9_]*$`, be 1–32 characters, and be unique
  within the strategy.
- In this preview, `source` is always `"yahoo"` and `field` is `"close"` or
  `"volume"`.
- Keep the existing backtest-response and deploy-response contracts unchanged.
- Update the confirmed-strategy and backtest-request examples together with the
  schema, frontend types, and conversation output.

### Proposed version 1.1 request fragment

```json
{
  "version": "1.1",
  "name": "FICO with falling yields and market confirmation",
  "thesis": "Falling yields and broad market strength can support FICO.",
  "target_tickers": ["FICO"],
  "direction": "long",
  "signal": {
    "sources": [
      {
        "key": "treasury_yield",
        "source": "yahoo",
        "symbol": "^TNX",
        "field": "close"
      },
      {
        "key": "market",
        "source": "yahoo",
        "symbol": "SPY",
        "field": "close"
      }
    ],
    "rule": "Enter when yields fall for three observations and SPY confirms the move.",
    "parameters": {
      "consecutive_observations": 3
    }
  },
  "execution": {
    "entry_timing": "next_trading_day_close",
    "holding_period_days": 5,
    "allocation_percent": 20,
    "ignore_overlapping_signals": true
  }
}
```

### Generated strategy data boundary

Version 1.0 remains unchanged:

```python
data["signal"]
data["prices"][target_ticker]
```

Version 1.1 receives:

```python
data["signals"][source_key]
data["prices"][target_ticker]
```

Each keyed signal is still a date-ascending list of `{ "date", "value" }`
rows. Generated code must request exactly the confirmed keys, symbols, and
fields. The trusted backend performs all yfinance calls.

### Fallback limitation

When model generation is unavailable, the deterministic version 1.1 fallback
emits a signal after all confirmed series decline together for the configured
`consecutive_observations`. It cannot faithfully interpret every complex
plain-language rule, so the existing fallback warning remains mandatory.

### Compatibility warning

Until the frozen schemas and frontend types adopt version 1.1, backend 1.1
requests intentionally exceed the published contract. Version 1.0 remains the
only fully shared contract and continues to pass its existing regression tests.
