"""Trusted historical-data adapters.

Provider-specific responses are converted here before generated strategy code sees
them.  The rest of the application should consume only the normalized dictionaries
returned by these functions.
"""

from __future__ import annotations

import calendar
from collections.abc import Callable, Mapping, Sequence
from datetime import date, datetime, timedelta, timezone
import math
from typing import Any
from zoneinfo import ZoneInfo


OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
BLS_TIMESERIES_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
YAHOO_FIELDS = frozenset({"close", "volume"})
BLS_FIELDS = frozenset({"cpi", "inflation_yoy_percent", "unemployment_rate_percent"})
BLS_SERIES = {
    "cpi": "CUSR0000SA0",
    "inflation_yoy_percent": "CUUR0000SA0",
    "unemployment_rate_percent": "LNS14000000",
}
OPEN_METEO_FIELDS = frozenset(
    {"precipitation_sum", "temperature_2m_max", "temperature_2m_min"}
)
US_MARKET_TIMEZONE = ZoneInfo("America/New_York")
MAX_HOURLY_RANGE_DAYS = 730


class DataSourceError(RuntimeError):
    """A user-safe failure while obtaining or normalizing historical data."""


def load_yahoo_prices(
    tickers: Sequence[str],
    start_date: date | str,
    end_date: date | str,
    *,
    download: Callable[..., Any] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Load adjusted daily close and volume rows for each target ticker.

    ``yfinance.download`` treats ``end`` as exclusive, so one day is added to the
    confirmed inclusive backtest end date.
    """

    symbols = _validate_symbols(tickers)
    start, end = _validate_date_range(start_date, end_date)
    provider_download = download or _yfinance_download()
    query: str | list[str] = symbols[0] if len(symbols) == 1 else symbols

    try:
        frame = provider_download(
            query,
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            auto_adjust=True,
            actions=False,
            progress=False,
            group_by="column",
            threads=False,
        )
    except Exception as exc:
        raise DataSourceError("Yahoo Finance data could not be loaded.") from exc

    if frame is None or not hasattr(frame, "empty") or frame.empty:
        raise DataSourceError("Yahoo Finance returned no historical data.")
    if not hasattr(frame, "columns") or not hasattr(frame, "index"):
        raise DataSourceError("Yahoo Finance returned an invalid response.")

    result: dict[str, list[dict[str, Any]]] = {}
    for symbol in symbols:
        close_series = _yahoo_series(frame, symbol, "Close", len(symbols))
        volume_series = _yahoo_series(frame, symbol, "Volume", len(symbols))
        rows = _normalize_yahoo_rows(frame.index, close_series, volume_series, symbol)
        if not rows:
            raise DataSourceError(f"Yahoo Finance returned no data for {symbol}.")
        result[symbol] = rows
    return result


def load_yahoo_signal(
    symbol: str,
    field: str,
    start_date: date | str,
    end_date: date | str,
    *,
    download: Callable[..., Any] | None = None,
) -> list[dict[str, Any]]:
    """Load a Yahoo signal independently of the target ticker data."""

    if field not in YAHOO_FIELDS:
        raise DataSourceError(f"Unsupported Yahoo field: {field}.")
    rows = load_yahoo_prices([symbol], start_date, end_date, download=download)[symbol]
    return [{"date": row["date"], "value": row[field]} for row in rows]


def load_yahoo_signals(
    sources: Sequence[Any],
    start_date: date | str,
    end_date: date | str,
    *,
    download: Callable[..., Any] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Load one or more uniquely keyed Yahoo signals in one provider request."""

    if isinstance(sources, (str, bytes)) or not sources:
        raise DataSourceError("At least one Yahoo signal source is required.")
    normalized_sources: list[tuple[str, str, str]] = []
    keys: set[str] = set()
    for source in sources:
        key = _source_value(source, "key")
        symbol = _source_value(source, "symbol")
        field = _source_value(source, "field")
        if not isinstance(key, str) or not key.strip() or key in keys:
            raise DataSourceError("Yahoo signal source keys must be unique and non-empty.")
        if field not in YAHOO_FIELDS:
            raise DataSourceError(f"Unsupported Yahoo field: {field}.")
        if not isinstance(symbol, str) or not symbol.strip():
            raise DataSourceError("Yahoo Finance symbols must be non-empty strings.")
        keys.add(key)
        normalized_sources.append((key, symbol, field))

    symbols = list(dict.fromkeys(symbol for _, symbol, _ in normalized_sources))
    histories = load_yahoo_prices(
        symbols, start_date, end_date, download=download
    )
    return {
        key: [{"date": row["date"], "value": row[field]} for row in histories[symbol]]
        for key, symbol, field in normalized_sources
    }


def load_yahoo_intraday_prices(
    tickers: Sequence[str],
    start_date: date | str,
    end_date: date | str,
    *,
    download: Callable[..., Any] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Load one-hour Yahoo bars restricted to the regular US trading session."""

    symbols = _validate_symbols(tickers)
    start, end = _validate_date_range(start_date, end_date)
    if (end - start).days >= MAX_HOURLY_RANGE_DAYS:
        raise DataSourceError(
            "Yahoo Finance hourly data requests may span at most 730 calendar days."
        )
    provider_download = download or _yfinance_download()
    session_bounds = _nyse_session_bounds(start, end)
    query: str | list[str] = symbols[0] if len(symbols) == 1 else symbols

    try:
        frame = provider_download(
            query,
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            interval="1h",
            prepost=False,
            auto_adjust=True,
            actions=False,
            progress=False,
            group_by="column",
            threads=False,
            ignore_tz=False,
        )
    except Exception as exc:
        raise DataSourceError("Yahoo Finance hourly data could not be loaded.") from exc

    if frame is None or not hasattr(frame, "empty") or frame.empty:
        raise DataSourceError("Yahoo Finance returned no hourly historical data.")
    if not hasattr(frame, "columns") or not hasattr(frame, "index"):
        raise DataSourceError("Yahoo Finance returned an invalid hourly response.")

    result: dict[str, list[dict[str, Any]]] = {}
    for symbol in symbols:
        close_series = _yahoo_series(frame, symbol, "Close", len(symbols))
        volume_series = _yahoo_series(frame, symbol, "Volume", len(symbols))
        rows = _normalize_yahoo_intraday_rows(
            frame.index, close_series, volume_series, symbol, session_bounds
        )
        if not rows:
            raise DataSourceError(
                f"Yahoo Finance returned no regular-session hourly data for {symbol}."
            )
        result[symbol] = rows
    return result


def load_yahoo_intraday_signals(
    sources: Sequence[Any],
    start_date: date | str,
    end_date: date | str,
    *,
    download: Callable[..., Any] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Load 1-10 keyed hourly Yahoo signals in one provider request."""

    if isinstance(sources, (str, bytes)) or not 1 <= len(sources) <= 10:
        raise DataSourceError("Between one and ten hourly Yahoo signals are required.")
    normalized_sources: list[tuple[str, str, str]] = []
    keys: set[str] = set()
    for source in sources:
        key = _source_value(source, "key")
        symbol = _source_value(source, "symbol")
        field = _source_value(source, "field")
        if not isinstance(key, str) or not key.strip() or key in keys:
            raise DataSourceError("Yahoo signal source keys must be unique and non-empty.")
        if field not in YAHOO_FIELDS:
            raise DataSourceError(f"Unsupported Yahoo field: {field}.")
        if not isinstance(symbol, str) or not symbol.strip():
            raise DataSourceError("Yahoo Finance symbols must be non-empty strings.")
        keys.add(key)
        normalized_sources.append((key, symbol, field))

    symbols = list(dict.fromkeys(symbol for _, symbol, _ in normalized_sources))
    histories = load_yahoo_intraday_prices(
        symbols, start_date, end_date, download=download
    )
    return {
        key: [{"date": row["date"], "value": row[field]} for row in histories[symbol]]
        for key, symbol, field in normalized_sources
    }


def load_bls_signals(
    sources: Sequence[Any],
    start_date: date | str,
    end_date: date | str,
    *,
    http_client: Any | None = None,
    registration_key: str | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Load keyed monthly CPI, inflation, and unemployment signals from BLS.

    BLS observations describe reference months rather than publication instants.
    To avoid exposing a value before it was known, each observation is dated on
    the first day of the second following month. This is intentionally later than
    the normal CPI and Employment Situation release windows.
    """

    if isinstance(sources, (str, bytes)) or not sources:
        raise DataSourceError("At least one BLS signal source is required.")
    start, end = _validate_date_range(start_date, end_date)
    normalized_sources: list[tuple[str, str]] = []
    keys: set[str] = set()
    for source in sources:
        key = _source_value(source, "key")
        field = _source_value(source, "field")
        if not isinstance(key, str) or not key.strip() or key in keys:
            raise DataSourceError("BLS signal source keys must be unique and non-empty.")
        if field not in BLS_FIELDS:
            raise DataSourceError(f"Unsupported BLS field: {field}.")
        keys.add(key)
        normalized_sources.append((key, field))

    owns_client = http_client is None
    client = http_client
    if client is None:
        try:
            import httpx
        except ImportError as exc:  # pragma: no cover - deployment configuration
            raise DataSourceError("The BLS HTTP client is unavailable.") from exc
        client = httpx.Client(timeout=20.0)

    query_start_year = start.year - 2
    series_ids = list(dict.fromkeys(BLS_SERIES[field] for _, field in normalized_sources))
    raw_by_series: dict[str, dict[date, float]] = {series_id: {} for series_id in series_ids}
    try:
        for first_year, last_year in _bls_year_chunks(
            query_start_year, end.year, registered=bool(registration_key)
        ):
            request_payload: dict[str, Any] = {
                "seriesid": series_ids,
                "startyear": str(first_year),
                "endyear": str(last_year),
            }
            if registration_key:
                request_payload["registrationkey"] = registration_key
            response = client.post(BLS_TIMESERIES_URL, json=request_payload)
            response.raise_for_status()
            chunk = _normalize_bls_payload(response.json(), series_ids)
            for series_id, values in chunk.items():
                for reference_date, value in values.items():
                    if reference_date in raw_by_series[series_id]:
                        raise DataSourceError(f"BLS returned duplicate dates for {series_id}.")
                    raw_by_series[series_id][reference_date] = value
    except DataSourceError:
        raise
    except Exception as exc:
        raise DataSourceError("BLS historical data could not be loaded.") from exc
    finally:
        if owns_client:
            client.close()

    result: dict[str, list[dict[str, Any]]] = {}
    for key, field in normalized_sources:
        values = raw_by_series[BLS_SERIES[field]]
        if field == "inflation_yoy_percent":
            values = _year_over_year_percent(values)
        rows = [
            {"date": available.isoformat(), "value": value}
            for reference_date, value in values.items()
            if start <= (available := _conservative_bls_availability(reference_date)) <= end
        ]
        rows.sort(key=lambda row: row["date"])
        if not rows:
            raise DataSourceError(f"BLS returned no historical data for {field}.")
        result[key] = rows
    return result


def load_open_meteo_signal(
    *,
    latitude: float,
    longitude: float,
    timezone: str,
    field: str,
    start_date: date | str,
    end_date: date | str,
    http_client: Any | None = None,
) -> list[dict[str, Any]]:
    """Load one daily signal from Open-Meteo's historical archive API."""

    if field not in OPEN_METEO_FIELDS:
        raise DataSourceError(f"Unsupported Open-Meteo field: {field}.")
    latitude_value = _finite_number(latitude, "latitude")
    longitude_value = _finite_number(longitude, "longitude")
    if not -90 <= latitude_value <= 90:
        raise DataSourceError("Open-Meteo latitude must be between -90 and 90.")
    if not -180 <= longitude_value <= 180:
        raise DataSourceError("Open-Meteo longitude must be between -180 and 180.")
    if not isinstance(timezone, str) or not timezone.strip():
        raise DataSourceError("Open-Meteo timezone must be provided.")
    start, end = _validate_date_range(start_date, end_date)

    owns_client = http_client is None
    client = http_client
    if client is None:
        try:
            import httpx
        except ImportError as exc:  # pragma: no cover - deployment configuration
            raise DataSourceError("The Open-Meteo HTTP client is unavailable.") from exc
        client = httpx.Client(timeout=20.0)

    params = {
        "latitude": latitude_value,
        "longitude": longitude_value,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": field,
        "timezone": timezone,
    }
    try:
        response = client.get(OPEN_METEO_ARCHIVE_URL, params=params)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        raise DataSourceError("Open-Meteo historical data could not be loaded.") from exc
    finally:
        if owns_client:
            client.close()

    return _normalize_open_meteo_payload(payload, field)


def _yfinance_download() -> Callable[..., Any]:
    try:
        import yfinance
    except ImportError as exc:  # pragma: no cover - deployment configuration
        raise DataSourceError("The Yahoo Finance client is unavailable.") from exc
    return yfinance.download


def _source_value(source: Any, name: str) -> Any:
    if isinstance(source, Mapping):
        return source.get(name)
    return getattr(source, name, None)


def _bls_year_chunks(
    start_year: int, end_year: int, *, registered: bool
) -> list[tuple[int, int]]:
    span = 20 if registered else 10
    chunks: list[tuple[int, int]] = []
    current = start_year
    while current <= end_year:
        chunk_end = min(current + span - 1, end_year)
        chunks.append((current, chunk_end))
        current = chunk_end + 1
    return chunks


def _normalize_bls_payload(
    payload: Any, expected_series: Sequence[str]
) -> dict[str, dict[date, float]]:
    if not isinstance(payload, Mapping) or payload.get("status") != "REQUEST_SUCCEEDED":
        raise DataSourceError("BLS returned an invalid response.")
    results = payload.get("Results")
    series_items = results.get("series") if isinstance(results, Mapping) else None
    if not isinstance(series_items, list):
        raise DataSourceError("BLS response is missing series data.")

    normalized: dict[str, dict[date, float]] = {}
    for series in series_items:
        if not isinstance(series, Mapping):
            raise DataSourceError("BLS returned malformed series data.")
        series_id = series.get("seriesID")
        data = series.get("data")
        if series_id not in expected_series or series_id in normalized or not isinstance(data, list):
            raise DataSourceError("BLS returned unexpected series data.")
        values: dict[date, float] = {}
        for item in data:
            if not isinstance(item, Mapping):
                raise DataSourceError(f"BLS returned malformed data for {series_id}.")
            year = item.get("year")
            period = item.get("period")
            if (
                not isinstance(year, str)
                or len(year) != 4
                or not year.isdigit()
                or not isinstance(period, str)
                or len(period) != 3
                or not period.startswith("M")
                or not period[1:].isdigit()
            ):
                raise DataSourceError(f"BLS returned an invalid period for {series_id}.")
            month = int(period[1:])
            if not 1 <= month <= 12:
                # M13 is an annual average, not a monthly observation.
                continue
            reference_date = date(int(year), month, 1)
            if reference_date in values:
                raise DataSourceError(f"BLS returned duplicate dates for {series_id}.")
            values[reference_date] = _finite_number(
                item.get("value"), f"BLS value for {series_id}"
            )
        normalized[series_id] = values

    if set(normalized) != set(expected_series) or any(not values for values in normalized.values()):
        raise DataSourceError("BLS returned incomplete historical data.")
    return normalized


def _year_over_year_percent(values: Mapping[date, float]) -> dict[date, float]:
    result: dict[date, float] = {}
    for reference_date, current in values.items():
        previous = values.get(date(reference_date.year - 1, reference_date.month, 1))
        if previous is not None:
            if previous <= 0:
                raise DataSourceError("BLS CPI data contains a non-positive value.")
            result[reference_date] = (current / previous - 1.0) * 100.0
    return result


def _conservative_bls_availability(reference_date: date) -> date:
    month_index = reference_date.year * 12 + reference_date.month - 1 + 2
    year, zero_based_month = divmod(month_index, 12)
    # calendar.monthrange also validates the generated year/month pair.
    calendar.monthrange(year, zero_based_month + 1)
    return date(year, zero_based_month + 1, 1)


def _validate_symbols(tickers: Sequence[str]) -> list[str]:
    if isinstance(tickers, (str, bytes)) or not tickers:
        raise DataSourceError("At least one Yahoo Finance symbol is required.")
    symbols: list[str] = []
    for ticker in tickers:
        if not isinstance(ticker, str) or not ticker.strip():
            raise DataSourceError("Yahoo Finance symbols must be non-empty strings.")
        symbol = ticker.strip()
        if symbol in symbols:
            raise DataSourceError(f"Duplicate Yahoo Finance symbol: {symbol}.")
        symbols.append(symbol)
    return symbols


def _validate_date_range(
    start_value: date | str, end_value: date | str
) -> tuple[date, date]:
    start = _parse_date(start_value, "start_date")
    end = _parse_date(end_value, "end_date")
    if start > end:
        raise DataSourceError("The historical-data start date must not follow the end date.")
    return start, end


def _parse_date(value: date | str, name: str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise DataSourceError(f"{name} must be a valid YYYY-MM-DD date.") from exc
        if parsed.isoformat() == value:
            return parsed
    raise DataSourceError(f"{name} must be a valid YYYY-MM-DD date.")


def _yahoo_series(frame: Any, symbol: str, field: str, symbol_count: int) -> Any:
    columns = frame.columns
    if getattr(columns, "nlevels", 1) > 1:
        candidates = ((field, symbol), (symbol, field))
        if field == "Close":
            candidates += (("Adj Close", symbol), (symbol, "Adj Close"))
        for candidate in candidates:
            if candidate in columns:
                return frame[candidate]
        raise DataSourceError(f"Yahoo Finance data for {symbol} is missing {field}.")

    if symbol_count != 1:
        raise DataSourceError("Yahoo Finance returned an invalid multi-symbol response.")
    candidates = [field]
    if field == "Close":
        candidates.append("Adj Close")
    for candidate in candidates:
        if candidate in columns:
            return frame[candidate]
    raise DataSourceError(f"Yahoo Finance data for {symbol} is missing {field}.")


def _normalize_yahoo_rows(
    index: Any, close_series: Any, volume_series: Any, symbol: str
) -> list[dict[str, Any]]:
    if len(index) != len(close_series) or len(index) != len(volume_series):
        raise DataSourceError(f"Yahoo Finance returned malformed data for {symbol}.")

    normalized: list[dict[str, Any]] = []
    seen_dates: set[str] = set()
    for raw_date, raw_close, raw_volume in zip(index, close_series, volume_series):
        row_date = _provider_date(raw_date, "Yahoo Finance")
        if row_date in seen_dates:
            raise DataSourceError(f"Yahoo Finance returned duplicate dates for {symbol}.")
        close = _finite_number(raw_close, f"Yahoo Finance close for {symbol}")
        volume = _finite_number(raw_volume, f"Yahoo Finance volume for {symbol}")
        if close <= 0:
            raise DataSourceError(f"Yahoo Finance returned a non-positive close for {symbol}.")
        if volume < 0:
            raise DataSourceError(f"Yahoo Finance returned a negative volume for {symbol}.")
        normalized.append(
            {
                "date": row_date,
                "close": close,
                "volume": int(volume) if volume.is_integer() else volume,
            }
        )
        seen_dates.add(row_date)
    normalized.sort(key=lambda row: row["date"])
    return normalized


def _normalize_yahoo_intraday_rows(
    index: Any,
    close_series: Any,
    volume_series: Any,
    symbol: str,
    session_bounds: Mapping[str, tuple[datetime, datetime]],
) -> list[dict[str, Any]]:
    if len(index) != len(close_series) or len(index) != len(volume_series):
        raise DataSourceError(f"Yahoo Finance returned malformed hourly data for {symbol}.")

    normalized: list[dict[str, Any]] = []
    seen_times: set[str] = set()
    for raw_time, raw_close, raw_volume in zip(index, close_series, volume_series):
        row_time = _regular_session_timestamp(
            raw_time, "Yahoo Finance", session_bounds
        )
        if row_time is None:
            continue
        if row_time in seen_times:
            raise DataSourceError(
                f"Yahoo Finance returned duplicate hourly timestamps for {symbol}."
            )
        close = _finite_number(raw_close, f"Yahoo Finance close for {symbol}")
        volume = _finite_number(raw_volume, f"Yahoo Finance volume for {symbol}")
        if close <= 0:
            raise DataSourceError(f"Yahoo Finance returned a non-positive close for {symbol}.")
        if volume < 0:
            raise DataSourceError(f"Yahoo Finance returned a negative volume for {symbol}.")
        normalized.append(
            {
                "date": row_time,
                "close": close,
                "volume": int(volume) if volume.is_integer() else volume,
            }
        )
        seen_times.add(row_time)
    normalized.sort(key=lambda row: row["date"])
    return normalized


def _normalize_open_meteo_payload(payload: Any, field: str) -> list[dict[str, Any]]:
    if not isinstance(payload, Mapping):
        raise DataSourceError("Open-Meteo returned an invalid response.")
    daily = payload.get("daily")
    if not isinstance(daily, Mapping):
        raise DataSourceError("Open-Meteo response is missing daily data.")
    dates = daily.get("time")
    values = daily.get(field)
    if not isinstance(dates, list) or not isinstance(values, list):
        raise DataSourceError(f"Open-Meteo response is missing {field} data.")
    if not dates or not values:
        raise DataSourceError("Open-Meteo returned no historical data.")
    if len(dates) != len(values):
        raise DataSourceError("Open-Meteo returned mismatched daily arrays.")

    normalized: list[dict[str, Any]] = []
    seen_dates: set[str] = set()
    for raw_date, raw_value in zip(dates, values):
        row_date = _parse_date(raw_date, "Open-Meteo date").isoformat()
        if row_date in seen_dates:
            raise DataSourceError("Open-Meteo returned duplicate daily dates.")
        value = _finite_number(raw_value, f"Open-Meteo {field}")
        normalized.append({"date": row_date, "value": value})
        seen_dates.add(row_date)
    normalized.sort(key=lambda row: row["date"])
    return normalized


def _provider_date(value: Any, provider: str) -> str:
    if hasattr(value, "date"):
        value = value.date()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10]).isoformat()
        except ValueError:
            pass
    raise DataSourceError(f"{provider} returned an invalid date.")


def _nyse_session_bounds(
    start: date, end: date
) -> dict[str, tuple[datetime, datetime]]:
    try:
        import pandas_market_calendars as market_calendars

        schedule = market_calendars.get_calendar("NYSE").schedule(
            start_date=start.isoformat(), end_date=end.isoformat()
        )
    except Exception as exc:
        raise DataSourceError("The US market calendar could not be loaded.") from exc
    return {
        str(session_date)[:10]: (
            row["market_open"].to_pydatetime().astimezone(timezone.utc),
            row["market_close"].to_pydatetime().astimezone(timezone.utc),
        )
        for session_date, row in schedule.iterrows()
    }


def _regular_session_timestamp(
    value: Any,
    provider: str,
    session_bounds: Mapping[str, tuple[datetime, datetime]],
) -> str | None:
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise DataSourceError(f"{provider} returned an invalid hourly timestamp.")
    row_start = value.astimezone(timezone.utc)
    session_date = value.astimezone(US_MARKET_TIMEZONE).date().isoformat()
    bounds = session_bounds.get(session_date)
    if bounds is None:
        return None
    session_open, session_close = bounds
    if not session_open <= row_start < session_close:
        return None
    bar_close = min(row_start + timedelta(hours=1), session_close)
    return (
        bar_close
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def _finite_number(value: Any, name: str) -> float:
    if value is None or isinstance(value, bool):
        raise DataSourceError(f"{name} contains a missing or invalid value.")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise DataSourceError(f"{name} contains a missing or invalid value.") from exc
    if not math.isfinite(number):
        raise DataSourceError(f"{name} contains a missing or invalid value.")
    return number
