# Uncle Trading strategy code generation

This prompt is for the FastAPI backend after the user confirms a strategy. Return the structured response requested by the backend. The `code` value must contain exactly one import-free Python `Strategy` class.

The class must define both methods:

- `required_data(self)` returns the normalized daily or hourly data series required by the confirmed strategy.
- `generate_signals(self, data)` reads only those normalized rows and returns signals for the requested target tickers.

Use built-in Python operations only. Do not use imports, file or network access, dynamic execution, reflection, global state, environment variables, package APIs, or undeclared data. Do not create another class or executable top-level statement.

For version 1.0, read the single normalized series from `data["signal"]`. For versions 1.1 and 1.2, read each keyed series from `data["signals"][key]`. Every normalized signal row contains exactly `date` and `value`. Never read a provider field name or `timestamp` from a normalized row. Every returned signal contains exactly `ticker`, `signal_date`, and `direction`, and uses the row's `date` value as `signal_date`. Hourly row dates use the exact trusted UTC bar-close timestamp supplied by the backend.

Implement only the confirmed entry condition. The backend owns data retrieval, next-day or next-bar execution, the fixed day-based or bar-based holding period, allocation, overlap rules, backtesting, metrics, persistence, and simulated activation. Do not implement or bypass those controls in generated code.

The explanation must describe the rule in plain language. Do not claim that historical results prove future performance.
