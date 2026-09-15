from __future__ import annotations

from copy import deepcopy

import pandas as pd
import pytest

from app.data_sources import (
    DataSourceError,
    OPEN_METEO_ARCHIVE_URL,
    load_open_meteo_signal,
    load_yahoo_prices,
    load_yahoo_signal,
)


def _ordinary_yahoo_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {"Close": [1800.5, 1812.25, 1799.0], "Volume": [125000, 131250, 98000]},
        index=pd.DatetimeIndex(
            ["2026-01-02 00:00:00-05:00", "2026-01-05 00:00:00-05:00", "2026-01-06 00:00:00-05:00"],
            name="Date",
        ),
    )


def _multi_index_yahoo_frame() -> pd.DataFrame:
    columns = pd.MultiIndex.from_tuples(
        [("Close", "FICO"), ("Close", "SPY"), ("Volume", "FICO"), ("Volume", "SPY")],
        names=["Price", "Ticker"],
    )
    return pd.DataFrame(
        [
            [1800.5, 590.0, 125000, 50000000],
            [1812.25, 592.5, 131250, 51000000],
        ],
        columns=columns,
        index=pd.DatetimeIndex(["2026-01-02", "2026-01-05"], name="Date"),
    )


class FakeResponse:
    def __init__(self, payload, *, error: Exception | None = None):
        self.payload = payload
        self.error = error

    def raise_for_status(self):
        if self.error:
            raise self.error

    def json(self):
        return deepcopy(self.payload)


class FakeHttpClient:
    def __init__(self, payload, *, error: Exception | None = None):
        self.response = FakeResponse(payload, error=error)
        self.calls = []

    def get(self, url, *, params):
        self.calls.append((url, params))
        return self.response


@pytest.fixture
def open_meteo_payload():
    return {
        "latitude": 43.75,
        "longitude": -79.375,
        "generationtime_ms": 0.082,
        "utc_offset_seconds": -18000,
        "timezone": "America/Toronto",
        "timezone_abbreviation": "GMT-5",
        "elevation": 175.0,
        "daily_units": {
            "time": "iso8601",
            "precipitation_sum": "mm",
            "temperature_2m_max": "°C",
            "temperature_2m_min": "°C",
        },
        "daily": {
            "time": ["2026-01-03", "2026-01-01", "2026-01-02"],
            "precipitation_sum": [2.4, 0.0, 1.2],
            "temperature_2m_max": [3.0, 1.5, 2.25],
            "temperature_2m_min": [-4.0, -6.5, -5.25],
        },
    }


def test_yahoo_prices_normalize_realistic_single_symbol_frame():
    calls = []

    def download(*args, **kwargs):
        calls.append((args, kwargs))
        return _ordinary_yahoo_frame()

    rows = load_yahoo_prices(["FICO"], "2026-01-01", "2026-01-06", download=download)

    assert rows == {
        "FICO": [
            {"date": "2026-01-02", "close": 1800.5, "volume": 125000},
            {"date": "2026-01-05", "close": 1812.25, "volume": 131250},
            {"date": "2026-01-06", "close": 1799.0, "volume": 98000},
        ]
    }
    assert calls == [
        (
            ("FICO",),
            {
                "start": "2026-01-01",
                "end": "2026-01-07",
                "auto_adjust": True,
                "actions": False,
                "progress": False,
                "group_by": "column",
                "threads": False,
            },
        )
    ]


def test_yahoo_prices_support_multi_index_and_sort_dates():
    frame = _multi_index_yahoo_frame().iloc[::-1]
    rows = load_yahoo_prices(
        ["FICO", "SPY"], "2026-01-01", "2026-01-05", download=lambda *a, **k: frame
    )

    assert rows["FICO"] == [
        {"date": "2026-01-02", "close": 1800.5, "volume": 125000},
        {"date": "2026-01-05", "close": 1812.25, "volume": 131250},
    ]
    assert rows["SPY"] == [
        {"date": "2026-01-02", "close": 590.0, "volume": 50000000},
        {"date": "2026-01-05", "close": 592.5, "volume": 51000000},
    ]


def test_yahoo_signal_uses_separate_symbol_and_selected_field():
    seen = []

    def download(symbol, **kwargs):
        seen.append(symbol)
        frame = _ordinary_yahoo_frame().rename(columns={"Close": "Adj Close"})
        return frame

    rows = load_yahoo_signal("^TNX", "close", "2026-01-01", "2026-01-06", download=download)

    assert seen == ["^TNX"]
    assert rows == [
        {"date": "2026-01-02", "value": 1800.5},
        {"date": "2026-01-05", "value": 1812.25},
        {"date": "2026-01-06", "value": 1799.0},
    ]


@pytest.mark.parametrize(
    "frame, message",
    [
        (pd.DataFrame(), "no historical data"),
        (_ordinary_yahoo_frame().drop(columns="Volume"), "missing Volume"),
        (_ordinary_yahoo_frame().assign(Close=[1800.5, float("nan"), 1799.0]), "invalid value"),
    ],
)
def test_yahoo_rejects_empty_missing_and_null_data(frame, message):
    with pytest.raises(DataSourceError, match=message):
        load_yahoo_prices(["FICO"], "2026-01-01", "2026-01-06", download=lambda *a, **k: frame)


def test_yahoo_wraps_provider_exception_without_exposing_it():
    def download(*args, **kwargs):
        raise RuntimeError("provider secret detail")

    with pytest.raises(DataSourceError, match="could not be loaded") as caught:
        load_yahoo_prices(["FICO"], "2026-01-01", "2026-01-06", download=download)
    assert "secret" not in str(caught.value)


def test_yahoo_rejects_non_dataframe_response():
    class InvalidFrame:
        empty = False

    with pytest.raises(DataSourceError, match="invalid response"):
        load_yahoo_prices(
            ["FICO"],
            "2026-01-01",
            "2026-01-06",
            download=lambda *args, **kwargs: InvalidFrame(),
        )


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        ("precipitation_sum", [0.0, 1.2, 2.4]),
        ("temperature_2m_max", [1.5, 2.25, 3.0]),
        ("temperature_2m_min", [-6.5, -5.25, -4.0]),
    ],
)
def test_open_meteo_normalizes_each_supported_field(open_meteo_payload, field, expected):
    client = FakeHttpClient(open_meteo_payload)

    rows = load_open_meteo_signal(
        latitude=43.6532,
        longitude=-79.3832,
        timezone="America/Toronto",
        field=field,
        start_date="2026-01-01",
        end_date="2026-01-03",
        http_client=client,
    )

    assert rows == [
        {"date": "2026-01-01", "value": expected[0]},
        {"date": "2026-01-02", "value": expected[1]},
        {"date": "2026-01-03", "value": expected[2]},
    ]
    assert client.calls == [
        (
            OPEN_METEO_ARCHIVE_URL,
            {
                "latitude": 43.6532,
                "longitude": -79.3832,
                "start_date": "2026-01-01",
                "end_date": "2026-01-03",
                "daily": field,
                "timezone": "America/Toronto",
            },
        )
    ]


@pytest.mark.parametrize("mutation", ["missing", "empty", "mismatched", "null"])
def test_open_meteo_rejects_bad_daily_shapes(open_meteo_payload, mutation):
    payload = deepcopy(open_meteo_payload)
    if mutation == "missing":
        del payload["daily"]["precipitation_sum"]
    elif mutation == "empty":
        payload["daily"]["precipitation_sum"] = []
    elif mutation == "mismatched":
        payload["daily"]["precipitation_sum"] = [0.0]
    else:
        payload["daily"]["precipitation_sum"][1] = None

    with pytest.raises(DataSourceError):
        load_open_meteo_signal(
            latitude=43.6532,
            longitude=-79.3832,
            timezone="America/Toronto",
            field="precipitation_sum",
            start_date="2026-01-01",
            end_date="2026-01-03",
            http_client=FakeHttpClient(payload),
        )


def test_open_meteo_wraps_http_failure(open_meteo_payload):
    client = FakeHttpClient(open_meteo_payload, error=RuntimeError("upstream details"))
    with pytest.raises(DataSourceError, match="could not be loaded"):
        load_open_meteo_signal(
            latitude=43.6532,
            longitude=-79.3832,
            timezone="America/Toronto",
            field="temperature_2m_max",
            start_date="2026-01-01",
            end_date="2026-01-03",
            http_client=client,
        )


@pytest.mark.parametrize(
    ("loader", "kwargs"),
    [
        (load_yahoo_signal, {"symbol": "^TNX", "field": "precipitation_sum", "download": lambda: None}),
        (
            load_open_meteo_signal,
            {
                "latitude": 43.6532,
                "longitude": -79.3832,
                "timezone": "America/Toronto",
                "field": "close",
                "http_client": FakeHttpClient({}),
            },
        ),
    ],
)
def test_adapters_reject_unsupported_fields(loader, kwargs):
    with pytest.raises(DataSourceError, match="Unsupported"):
        loader(start_date="2026-01-01", end_date="2026-01-03", **kwargs)
