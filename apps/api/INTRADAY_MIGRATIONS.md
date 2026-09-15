# Intraday API Contract Migration

This file records the additive backend version 1.2 contract. The local
integration worktree now includes the matching frozen schemas, examples,
frontend types, and conversation prompt. Promotion to `main` is still pending.

## Why a contract change is required

The published contract supports daily observations only. It fixes entry timing
to `next_trading_day_close`, measures holding periods in trading days, and
requires date-only trade and equity points. An hourly strategy cannot express
its bar interval, regular-session restriction, bar-based holding period, or UTC
execution timestamps with that shape.

Versions 1.0 and 1.1 retain their current fields, validation, daily data, and
response values. Version 1.2 is an additive alternative.

## Proposed version 1.2 request changes

- Add `"1.2"` as a confirmed-strategy version.
- Require exactly one target ticker.
- Use `signal.sources` with 1–10 unique keyed Yahoo Finance sources.
- Continue to allow only `close` and `volume` signal fields.
- Replace the daily execution object with the version 1.2 execution object:
  - `bar_interval` is exactly `"1h"`.
  - `session` is exactly `"regular"`.
  - `entry_timing` is exactly `"next_trading_bar_close"`.
  - `holding_period_bars` is an integer from 1 through 1,764.
  - `allocation_percent` and `ignore_overlapping_signals` retain their existing
    meanings and validation.
- Do not send `holding_period_days` in version 1.2.
- Keep `backtest.start_date`, `backtest.end_date`, and `initial_capital`
  unchanged. Yahoo currently restricts 1-hour history to a recent 730-day
  window, so a version 1.2 request may span at most 730 inclusive calendar days
  and can still fail when the requested range is outside Yahoo's availability.

### Proposed request example

```json
{
  "strategy": {
    "version": "1.2",
    "name": "Hourly FICO market confirmation",
    "thesis": "Synchronized hourly weakness can create a short-term entry.",
    "target_tickers": ["FICO"],
    "direction": "long",
    "signal": {
      "sources": [
        {
          "key": "market",
          "source": "yahoo",
          "symbol": "SPY",
          "field": "close"
        },
        {
          "key": "technology",
          "source": "yahoo",
          "symbol": "QQQ",
          "field": "volume"
        }
      ],
      "rule": "Enter after both hourly series decline together.",
      "parameters": {
        "consecutive_observations": 1
      }
    },
    "execution": {
      "bar_interval": "1h",
      "session": "regular",
      "entry_timing": "next_trading_bar_close",
      "holding_period_bars": 14,
      "allocation_percent": 20,
      "ignore_overlapping_signals": true
    }
  },
  "backtest": {
    "start_date": "2026-01-01",
    "end_date": "2026-06-30",
    "initial_capital": 10000
  }
}
```

Fourteen bars intentionally demonstrate a position held across more than one
regular session. The position remains open overnight, but no overnight price is
used for entry, exit, signal evaluation, or equity sampling.

## Response changes

The response object and field names stay the same. For a version 1.2 result:

- `equity_curve[].date` changes from a `date` to an ISO 8601 UTC `date-time`
  ending in `Z`.
- `trades[].entry_date` and `trades[].exit_date` likewise contain UTC
  `date-time` values.
- These timestamps represent hourly-bar closes, not bar starts.
- Metrics retain their names and percentage-point units.
- Sharpe ratio annualization uses 252 trading days times 6.5 trading hours.

This response-contract widening is supported by timestamp-aware frontend parsing
in the local integration worktree.

## Regular-session and holding behavior

- The trusted backend requests yfinance with `interval="1h"` and
  `prepost=False`.
- It independently validates timestamps against the NYSE calendar's actual
  regular-session open and close, including holidays and early closes, and stores
  the corresponding bar-close instant in UTC.
- Pre-market, after-hours, overnight, and weekend bars are discarded even if a
  provider unexpectedly returns them.
- A signal enters at the next available regular-session bar close.
- `holding_period_bars` counts only available regular-session bars. It naturally
  skips nights, weekends, holidays, and missing bars, so positions can remain
  open for multiple calendar days without trading outside the session.
- Simulated activation schedules the next weekday regular-session bar close.
  There is still no real scheduler or order execution.

## Generated strategy boundary

Version 1.2 uses the existing keyed structure:

```python
data["signals"][source_key]
data["prices"][target_ticker]
```

Each row's `date` value is a UTC bar-close timestamp rather than `YYYY-MM-DD`.
Generated signals return that value unchanged as `signal_date`. Generated code
does not download data. The backend rejects any generated signal timestamp that
does not exactly match a trusted, normalized source row, so generated code cannot
introduce extended-hours, weekend, holiday, or otherwise fabricated signal bars.

## Coordinated adoption checklist

- [x] Update confirmed-strategy schema with the version 1.2 request variant.
- [x] Update backtest-response schema to accept timestamped v1.2 result points.
- [x] Add version 1.2 request and response examples.
- [x] Update frontend TypeScript types and timestamp rendering.
- [x] Update the conversation prompt with hourly/session/holding choices.
- [x] Preserve version 1.0 and 1.1 regression fixtures.
- [x] Keep `DATA_SOURCES.md`, backend prompt instructions, mocked tests, and
      Docker image current as implementation changes.

## Local frontend integration status

The integration worktree now supports discriminated 1.0, 1.1, and 1.2 request
types, hourly draft fields, keyed Yahoo sources, bar-based holding periods, and
UTC timestamp display. The frozen request and response examples are covered by
frontend runtime-validation tests and backend JSON Schema tests.

The backend now supports main's `GET /strategies/{strategy_id}` flow for version
1.2: the stored timestamped response round-trips unchanged, and simulated
activation schedules the next calendar-valid hourly bar close.
