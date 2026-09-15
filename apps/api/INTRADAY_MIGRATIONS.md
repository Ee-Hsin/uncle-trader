# Pending Intraday API Contract Migration

This file records the additive backend version 1.2 preview. It does not replace
`contracts/**`, which remains the frozen shared source of truth until Jordan
updates the schemas, examples, frontend types, and conversation prompt.

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

This is a response-contract widening and frontend date parsing must be updated
before version 1.2 is exposed through the shared application.

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

- [ ] Update confirmed-strategy schema with the version 1.2 request variant.
- [ ] Update backtest-response schema to accept timestamped v1.2 result points.
- [ ] Add version 1.2 request and response examples.
- [ ] Update frontend TypeScript types and timestamp rendering.
- [ ] Update the conversation prompt with hourly/session/holding choices.
- [ ] Preserve version 1.0 and 1.1 regression fixtures.
- [ ] Keep `DATA_SOURCES.md`, backend prompt instructions, mocked tests, and
      Docker image current as implementation changes.

## Latest frontend-main integration findings

Checked against frontend main commit `f6d4f6f`:

- `apps/web/lib/contracts.ts` currently defines only strategy version `1.0`,
  validates only the daily signal and execution shapes, and requires date-only
  equity/trade values. It must add discriminated 1.2 request types and accept UTC
  timestamps in 1.2 results.
- `apps/web/lib/conversation.ts` models only the daily draft fields. It needs
  version 1.2, `signal.sources`, `bar_interval`, `session`,
  `next_trading_bar_close`, and `holding_period_bars` draft/confirmation paths.
- `prompts/conversation-agent.md` explicitly rejects intraday strategies. Jordan
  must update it with the version 1.2 source, session, interval, and holding
  constraints when the shared contract is approved.
- `apps/web/lib/presentation.ts` and `apps/web/components/types.ts` expose only
  `holdingPeriodDays` and a single signal. They need an hourly/multi-source view
  and timestamp-aware labels.
- `apps/web/app/page.tsx` confirmation paths and editing callbacks assume the
  version 1.0 single daily signal shape.
- The existing chart and trade components already carry result dates as strings,
  but their rendering must be verified with multiple points and trades per day.

The backend now supports main's `GET /strategies/{strategy_id}` flow for version
1.2: the stored timestamped response round-trips unchanged, and simulated
activation schedules the next calendar-valid hourly bar close.
