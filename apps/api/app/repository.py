"""SQLite persistence for completed backtests and simulated activation."""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import date, datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Mapping


DEFAULT_DATABASE_PATH = "./uncle_trading.db"


class RepositoryError(RuntimeError):
    """A user-safe persistence failure."""


class StrategyNotFoundError(RepositoryError):
    """The requested strategy is not stored."""


class StrategyNotDeployableError(RepositoryError):
    """The requested strategy is not in the completed state."""


@dataclass(frozen=True)
class StoredStrategy:
    strategy_id: str
    strategy: dict[str, Any]
    backtest: dict[str, Any]
    generated_code: str
    response: dict[str, Any]
    status: str
    created_at: datetime
    next_check_at: datetime | None


class StrategyRepository:
    """Store successful strategies in a local SQLite database.

    A new connection is opened for each operation so callers can safely reuse a
    repository from FastAPI request handlers. SQLite transactions, rather than
    in-process locks, protect state transitions.
    """

    def __init__(
        self,
        database_path: str | os.PathLike[str] | None = None,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        configured_path = database_path or os.environ.get(
            "API_DATABASE_PATH", DEFAULT_DATABASE_PATH
        )
        self.database_path = str(configured_path)
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._initialize_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize_schema(self) -> None:
        try:
            if self.database_path != ":memory:":
                Path(self.database_path).expanduser().parent.mkdir(
                    parents=True, exist_ok=True
                )
            with closing(self._connect()) as connection, connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS strategies (
                        strategy_id TEXT PRIMARY KEY,
                        strategy_json TEXT NOT NULL,
                        backtest_json TEXT NOT NULL,
                        generated_code TEXT NOT NULL,
                        response_json TEXT NOT NULL,
                        status TEXT NOT NULL CHECK (status IN ('complete', 'active')),
                        created_at TEXT NOT NULL,
                        next_check_at TEXT
                    )
                    """
                )
        except (OSError, sqlite3.Error) as exc:
            raise RepositoryError("The strategy database could not be initialized.") from exc

    def save_completed(
        self,
        request: Any,
        response: Any,
        *,
        strategy_id: str | None = None,
        generated_code: str | None = None,
    ) -> StoredStrategy:
        """Persist one complete response and the request that produced it."""

        request_value = _as_mapping(request, "request")
        response_value = _as_mapping(response, "response")

        if response_value.get("status") != "complete":
            raise RepositoryError("Only complete backtest responses can be saved.")

        response_id = response_value.get("strategy_id")
        response_code = response_value.get("generated_code")
        resolved_id = strategy_id or response_id
        resolved_code = generated_code or response_code
        if not isinstance(resolved_id, str) or not resolved_id.strip():
            raise RepositoryError("A non-empty strategy ID is required.")
        if not isinstance(resolved_code, str) or not resolved_code.strip():
            raise RepositoryError("Non-empty generated strategy code is required.")
        if response_id != resolved_id or response_code != resolved_code:
            raise RepositoryError(
                "Stored strategy metadata must match the complete response."
            )

        strategy = _as_mapping(request_value.get("strategy"), "request.strategy")
        backtest = _as_mapping(request_value.get("backtest"), "request.backtest")
        created_at = _ensure_utc(self._clock(), "created_at")

        try:
            with closing(self._connect()) as connection, connection:
                connection.execute(
                    """
                    INSERT INTO strategies (
                        strategy_id,
                        strategy_json,
                        backtest_json,
                        generated_code,
                        response_json,
                        status,
                        created_at,
                        next_check_at
                    ) VALUES (?, ?, ?, ?, ?, 'complete', ?, NULL)
                    """,
                    (
                        resolved_id,
                        _to_json(strategy),
                        _to_json(backtest),
                        resolved_code,
                        _to_json(response_value),
                        _to_utc_text(created_at),
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise RepositoryError("A strategy with this ID is already saved.") from exc
        except sqlite3.Error as exc:
            raise RepositoryError("The completed strategy could not be saved.") from exc

        stored = self.fetch(resolved_id)
        if stored is None:  # Defensive: a committed insert must be readable.
            raise RepositoryError("The completed strategy could not be read after saving.")
        return stored

    def fetch(self, strategy_id: str) -> StoredStrategy | None:
        """Return a stored strategy, or ``None`` when the ID is unknown."""

        try:
            with closing(self._connect()) as connection:
                row = connection.execute(
                    "SELECT * FROM strategies WHERE strategy_id = ?", (strategy_id,)
                ).fetchone()
        except sqlite3.Error as exc:
            raise RepositoryError("The strategy database could not be read.") from exc

        return _row_to_strategy(row) if row is not None else None

    def activate(self, strategy_id: str, next_check_at: datetime) -> StoredStrategy:
        """Atomically transition a completed strategy to simulated active status."""

        next_check = _ensure_utc(next_check_at, "next_check_at")

        try:
            with closing(self._connect()) as connection, connection:
                cursor = connection.execute(
                    """
                    UPDATE strategies
                    SET status = 'active', next_check_at = ?
                    WHERE strategy_id = ? AND status = 'complete'
                    """,
                    (_to_utc_text(next_check), strategy_id),
                )
                if cursor.rowcount != 1:
                    row = connection.execute(
                        "SELECT status FROM strategies WHERE strategy_id = ?",
                        (strategy_id,),
                    ).fetchone()
                    if row is None:
                        raise StrategyNotFoundError("The strategy was not found.")
                    raise StrategyNotDeployableError(
                        "Only a completed strategy can be activated."
                    )
        except RepositoryError:
            raise
        except sqlite3.Error as exc:
            raise RepositoryError("The strategy could not be activated.") from exc

        stored = self.fetch(strategy_id)
        if stored is None:  # Defensive: a committed update must remain readable.
            raise RepositoryError("The activated strategy could not be read.")
        return stored


def _as_mapping(value: Any, label: str) -> dict[str, Any]:
    if value is None:
        raise RepositoryError(f"{label} is required.")

    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    elif hasattr(value, "dict") and callable(value.dict):
        value = value.dict()
    elif isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise RepositoryError(f"{label} must contain valid JSON.") from exc

    if not isinstance(value, Mapping):
        raise RepositoryError(f"{label} must be an object.")
    return dict(value)


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return _to_utc_text(_ensure_utc(value, "JSON datetime"))
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _to_json(value: Mapping[str, Any]) -> str:
    try:
        return json.dumps(
            value,
            default=_json_default,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as exc:
        raise RepositoryError("Strategy data could not be serialized.") from exc


def _ensure_utc(value: datetime, label: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise RepositoryError(f"{label} must be a timezone-aware datetime.")
    return value.astimezone(timezone.utc)


def _to_utc_text(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def _from_utc_text(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return _ensure_utc(parsed, "stored timestamp")


def _row_to_strategy(row: sqlite3.Row) -> StoredStrategy:
    try:
        return StoredStrategy(
            strategy_id=row["strategy_id"],
            strategy=json.loads(row["strategy_json"]),
            backtest=json.loads(row["backtest_json"]),
            generated_code=row["generated_code"],
            response=json.loads(row["response_json"]),
            status=row["status"],
            created_at=_from_utc_text(row["created_at"]),
            next_check_at=(
                _from_utc_text(row["next_check_at"])
                if row["next_check_at"] is not None
                else None
            ),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RepositoryError("Stored strategy data is invalid.") from exc
