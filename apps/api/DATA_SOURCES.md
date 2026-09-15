# Available Historical Data Sources

This is the backend's current data-source catalog. Strategy generation receives
the same catalog as part of its runtime instructions. A provider, field, or
version combination not listed here is unsupported and must not be invented.

## Yahoo Finance

- Contract value: `"source": "yahoo"`
- Client: `yfinance`
- Authentication: none
- Frequency: normalized daily rows
- Inclusive backtest range: the backend adjusts yfinance's exclusive end date
- Supported signal fields:
  - `close`: auto-adjusted daily closing price
  - `volume`: daily traded volume
- Target-ticker rows contain `date`, `close`, and `volume`.
- Signal rows contain `date` and the selected field normalized as `value`.
- Symbols: any non-empty symbol that Yahoo Finance recognizes and returns usable
  history for. This is intentionally not a fixed symbol allowlist.

Common symbol examples (not exhaustive):

- Equities: `FICO`, `AAPL`, `MSFT`, `NVDA`
- Broad-market ETFs: `SPY`, `QQQ`, `DIA`, `IWM`, `VOO`, `IVV`, `VTI`
- Sector and asset ETFs: `XLK`, `XLF`, `XLY`, `GLD`, `TLT`, `HYG`, `USO`
- Yahoo indexes and market indicators: `^TNX`, `^VIX`, `^GSPC`, `^IXIC`

Yahoo availability is external and can vary by symbol and requested date range.
The backend returns a data-unavailable error when Yahoo has no usable history.

## Open-Meteo Historical Weather

- Contract value: `"source": "open_meteo"`
- Endpoint: Open-Meteo Historical Weather API
- Authentication: none
- Frequency: normalized daily rows
- Required location values:
  - `name`
  - `latitude`
  - `longitude`
  - IANA `timezone`, such as `America/Toronto`
- Supported signal fields:
  - `precipitation_sum`
  - `temperature_2m_max`
  - `temperature_2m_min`
- Signal rows contain `date` and the selected field normalized as `value`.

## Availability by Strategy Version

### Version 1.0

- Exactly one signal source.
- The signal may use Yahoo Finance or Open-Meteo.
- Target ticker prices always come from Yahoo Finance.

### Version 1.1 backend preview

- Between 2 and 10 uniquely keyed signal sources.
- Every signal source must use Yahoo Finance.
- Exactly one target ticker is traded.
- Open-Meteo cannot currently be mixed into a version 1.1 strategy.

See `MIGRATIONS.md` for the pending shared-contract changes required before
version 1.1 becomes part of the frozen frontend/backend contract.

## Explicitly Unavailable

The backend does not currently provide:

- FRED or St. Louis Fed data
- BLS data
- Direct inflation, CPI, unemployment, GDP, or interest-rate database series
- Company fundamentals, earnings, or financial statements
- News, sentiment, social media, or analyst data
- Intraday or real-time streaming data
- Cryptocurrency exchange APIs

Some market expectations or proxies may exist as Yahoo-traded symbols, but they
must be represented as Yahoo symbols using only `close` or `volume`; they are not
official economic-data series.

## Maintenance Requirement

Update this file, the backend generation catalog in `app/generator.py`, contract
migration notes, validation, adapters, mocked tests, and Docker dependencies
together whenever a source or field is added or removed. Rebuild the Docker image
as development changes dependencies or copied runtime files.
