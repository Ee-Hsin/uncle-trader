export type StrategyVersion = "1.0" | "1.1" | "1.2";
export type Direction = "long" | "short";
export type SignalSource = "yahoo" | "open_meteo";
export type YahooSignalField = "close" | "volume";
export type BlsSignalField = "cpi" | "inflation_yoy_percent" | "unemployment_rate_percent";
export type WeatherSignalField =
  | "precipitation_sum"
  | "temperature_2m_max"
  | "temperature_2m_min";
export type SignalField = YahooSignalField | WeatherSignalField;
export type MultiSignalField = YahooSignalField | BlsSignalField;

export interface StrategyLocation {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export type SignalParameter = string | number | boolean;

export interface YahooSignal {
  source: "yahoo";
  symbol: string;
  field: YahooSignalField;
  location?: StrategyLocation;
  rule: string;
  parameters: Record<string, SignalParameter>;
}

export interface OpenMeteoSignal {
  source: "open_meteo";
  symbol?: string;
  field: WeatherSignalField;
  location: StrategyLocation;
  rule: string;
  parameters: Record<string, SignalParameter>;
}

export type StrategySignal = YahooSignal | OpenMeteoSignal;

export interface KeyedYahooSignal {
  key: string;
  source: "yahoo";
  symbol: string;
  field: YahooSignalField;
}

export interface KeyedBlsSignal {
  key: string;
  source: "bls";
  field: BlsSignalField;
}

export interface MultiSignal {
  sources: Array<KeyedYahooSignal | KeyedBlsSignal>;
  rule: string;
  parameters: Record<string, SignalParameter>;
}

export interface DailyStrategyExecution {
  entry_timing: "next_trading_day_close";
  holding_period_days: number;
  allocation_percent: number;
  ignore_overlapping_signals: true;
}

export interface IntradayStrategyExecution {
  bar_interval: "1h";
  session: "regular";
  entry_timing: "next_trading_bar_close";
  holding_period_bars: number;
  allocation_percent: number;
  ignore_overlapping_signals: true;
}

interface StrategyBase {
  name: string;
  thesis: string;
  target_tickers: string[];
  direction: Direction;
}

export type ConfirmedStrategy =
  | (StrategyBase & { version: "1.0"; signal: StrategySignal; execution: DailyStrategyExecution })
  | (StrategyBase & { version: "1.1"; signal: MultiSignal; execution: DailyStrategyExecution })
  | (StrategyBase & { version: "1.2"; signal: MultiSignal; execution: IntradayStrategyExecution });

export interface BacktestSettings {
  start_date: string;
  end_date: string;
  initial_capital: number;
}

export interface BacktestRequest {
  strategy: ConfirmedStrategy;
  backtest: BacktestSettings;
}

export type ApiErrorCode =
  | "invalid_request"
  | "generation_failed"
  | "generated_code_rejected"
  | "data_unavailable"
  | "backtest_failed"
  | "strategy_not_found";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface BacktestMetrics {
  total_pnl: number;
  total_return_percent: number;
  sharpe_ratio: number | null;
  average_pnl_per_trade: number;
  expected_value_per_trade: number;
  win_rate_percent: number;
  max_drawdown_percent: number;
  trade_count: number;
  buy_and_hold_return_percent: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface BacktestTrade {
  entry_date: string;
  exit_date: string;
  direction: Direction;
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl: number;
  return_percent: number;
}

export interface TickerBacktestResult {
  ticker: string;
  metrics: BacktestMetrics;
  equity_curve: EquityPoint[];
  trades: BacktestTrade[];
}

export interface BacktestSuccessResponse {
  status: "complete";
  strategy_id: string;
  strategy_summary: string;
  generated_code: string;
  warnings: string[];
  results: TickerBacktestResult[];
}

export interface BacktestErrorResponse {
  status: "error";
  generated_code: string;
  error: ApiError;
}

export type BacktestResponse = BacktestSuccessResponse | BacktestErrorResponse;

export interface DeploySuccessResponse {
  status: "active";
  strategy_id: string;
  active: true;
  next_check_at: string;
}

export interface DeployErrorResponse {
  status: "error";
  error: ApiError;
}

export type DeployResponse = DeploySuccessResponse | DeployErrorResponse;

export class ContractValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractValidationError";
  }
}

type JsonObject = Record<string, unknown>;

const TICKER_PATTERN = /^[A-Z]{1,5}(?:[.-][A-Z])?$/;
const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const UTC_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const TIMEZONE_PATTERN = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9._+-]+)+)$/;
const ERROR_CODES = new Set<ApiErrorCode>([
  "invalid_request",
  "generation_failed",
  "generated_code_rejected",
  "data_unavailable",
  "backtest_failed",
  "strategy_not_found",
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonObject, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => key in value) && keys.every((key) => required.includes(key) || optional.includes(key));
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && /\S/.test(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !TIMEZONE_PATTERN.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isTicker(value: unknown): value is string {
  return typeof value === "string" && TICKER_PATTERN.test(value);
}

function isLocation(value: unknown): value is StrategyLocation {
  return (
    isObject(value) &&
    hasOnlyKeys(value, ["name", "latitude", "longitude", "timezone"]) &&
    isNonBlank(value.name) &&
    isFiniteNumber(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    isFiniteNumber(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180 &&
    isTimezone(value.timezone)
  );
}

function isParameters(value: unknown): value is Record<string, SignalParameter> {
  return (
    isObject(value) &&
    Object.values(value).every(
      (item) =>
        typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)),
    )
  );
}

function isSignal(value: unknown): value is StrategySignal {
  if (!isObject(value) || !hasOnlyKeys(value, ["source", "field", "rule", "parameters"], ["symbol", "location"])) {
    return false;
  }
  if (!isNonBlank(value.rule) || !isParameters(value.parameters)) return false;
  if (value.source === "yahoo") {
    return (
      isNonBlank(value.symbol) &&
      (value.field === "close" || value.field === "volume") &&
      (value.location === undefined || isLocation(value.location))
    );
  }
  if (value.source === "open_meteo") {
    return (
      (value.field === "precipitation_sum" ||
        value.field === "temperature_2m_max" ||
        value.field === "temperature_2m_min") &&
      isLocation(value.location) &&
      (value.symbol === undefined || isNonBlank(value.symbol))
    );
  }
  return false;
}

function isKeyedSignal(value: unknown): value is KeyedYahooSignal | KeyedBlsSignal {
  if (!isObject(value) || !isNonBlank(value.key) || !/^[a-z][a-z0-9_]{0,31}$/.test(value.key)) return false;
  if (value.source === "yahoo") {
    return hasOnlyKeys(value, ["key", "source", "symbol", "field"])
      && isNonBlank(value.symbol)
      && (value.field === "close" || value.field === "volume");
  }
  return value.source === "bls"
    && hasOnlyKeys(value, ["key", "source", "field"])
    && (value.field === "cpi" || value.field === "inflation_yoy_percent" || value.field === "unemployment_rate_percent");
}

function isMultiSignal(value: unknown): value is MultiSignal {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["sources", "rule", "parameters"]) ||
    !Array.isArray(value.sources) ||
    value.sources.length < 1 ||
    value.sources.length > 10 ||
    !value.sources.every(isKeyedSignal) ||
    !isNonBlank(value.rule) ||
    !isParameters(value.parameters)
  ) {
    return false;
  }
  const keys = value.sources.map((source) => source.key);
  return new Set(keys).size === keys.length;
}

function isDailyExecution(value: unknown): value is DailyStrategyExecution {
  return (
    isObject(value) &&
    hasOnlyKeys(value, [
      "entry_timing",
      "holding_period_days",
      "allocation_percent",
      "ignore_overlapping_signals",
    ]) &&
    value.entry_timing === "next_trading_day_close" &&
    Number.isInteger(value.holding_period_days) &&
    (value.holding_period_days as number) >= 1 &&
    (value.holding_period_days as number) <= 252 &&
    isFiniteNumber(value.allocation_percent) &&
    value.allocation_percent > 0 &&
    value.allocation_percent <= 100 &&
    value.ignore_overlapping_signals === true
  );
}

function isIntradayExecution(value: unknown): value is IntradayStrategyExecution {
  return (
    isObject(value) &&
    hasOnlyKeys(value, [
      "bar_interval",
      "session",
      "entry_timing",
      "holding_period_bars",
      "allocation_percent",
      "ignore_overlapping_signals",
    ]) &&
    value.bar_interval === "1h" &&
    value.session === "regular" &&
    value.entry_timing === "next_trading_bar_close" &&
    Number.isInteger(value.holding_period_bars) &&
    (value.holding_period_bars as number) >= 1 &&
    (value.holding_period_bars as number) <= 1764 &&
    isFiniteNumber(value.allocation_percent) &&
    value.allocation_percent > 0 &&
    value.allocation_percent <= 100 &&
    value.ignore_overlapping_signals === true
  );
}

export function isConfirmedStrategy(value: unknown): value is ConfirmedStrategy {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["version", "name", "thesis", "target_tickers", "direction", "signal", "execution"])
  ) {
    return false;
  }
  const tickers = value.target_tickers;
  const commonValid = (
    isNonBlank(value.name) &&
    isNonBlank(value.thesis) &&
    Array.isArray(tickers) &&
    tickers.length >= 1 &&
    tickers.length <= 5 &&
    tickers.every(isTicker) &&
    new Set(tickers).size === tickers.length &&
    (value.direction === "long" || value.direction === "short")
  );
  if (!commonValid) return false;
  if (value.version === "1.0") return isSignal(value.signal) && isDailyExecution(value.execution);
  if (value.version === "1.1") {
    return tickers.length === 1
      && isMultiSignal(value.signal)
      && isDailyExecution(value.execution);
  }
  return value.version === "1.2"
    && tickers.length === 1
    && isMultiSignal(value.signal)
    && value.signal.sources.every((source) => source.source === "yahoo")
    && isIntradayExecution(value.execution);
}

export function isBacktestRequest(value: unknown): value is BacktestRequest {
  if (!isObject(value) || !hasOnlyKeys(value, ["strategy", "backtest"]) || !isConfirmedStrategy(value.strategy)) {
    return false;
  }
  const backtest = value.backtest;
  return (
    isObject(backtest) &&
    hasOnlyKeys(backtest, ["start_date", "end_date", "initial_capital"]) &&
    isDate(backtest.start_date) &&
    isDate(backtest.end_date) &&
    backtest.start_date <= backtest.end_date &&
    isFiniteNumber(backtest.initial_capital) &&
    backtest.initial_capital > 0
  );
}

function isApiError(value: unknown): value is ApiError {
  if (!isObject(value) || !hasOnlyKeys(value, ["code", "message"], ["details"])) return false;
  if (!ERROR_CODES.has(value.code as ApiErrorCode) || !isNonBlank(value.message)) return false;
  return (
    value.details === undefined ||
    (isObject(value.details) &&
      Object.values(value.details).every(
        (item) =>
          item === null ||
          typeof item === "string" ||
          typeof item === "boolean" ||
          (typeof item === "number" && Number.isFinite(item)),
      ))
  );
}

function isMetrics(value: unknown): value is BacktestMetrics {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "total_pnl",
      "total_return_percent",
      "sharpe_ratio",
      "average_pnl_per_trade",
      "expected_value_per_trade",
      "win_rate_percent",
      "max_drawdown_percent",
      "trade_count",
      "buy_and_hold_return_percent",
    ])
  ) {
    return false;
  }
  return (
    isFiniteNumber(value.total_pnl) &&
    isFiniteNumber(value.total_return_percent) &&
    (value.sharpe_ratio === null || isFiniteNumber(value.sharpe_ratio)) &&
    isFiniteNumber(value.average_pnl_per_trade) &&
    isFiniteNumber(value.expected_value_per_trade) &&
    isFiniteNumber(value.win_rate_percent) &&
    value.win_rate_percent >= 0 &&
    value.win_rate_percent <= 100 &&
    isFiniteNumber(value.max_drawdown_percent) &&
    value.max_drawdown_percent <= 0 &&
    Number.isInteger(value.trade_count) &&
    (value.trade_count as number) >= 0 &&
    isFiniteNumber(value.buy_and_hold_return_percent)
  );
}

function isEquityPoint(value: unknown): value is EquityPoint {
  return (
    isObject(value) &&
    hasOnlyKeys(value, ["date", "equity"]) &&
    isPointTime(value.date) &&
    isFiniteNumber(value.equity) &&
    value.equity >= 0
  );
}

function isPointTime(value: unknown): value is string {
  return isDate(value)
    || (typeof value === "string" && UTC_DATE_TIME_PATTERN.test(value) && Number.isFinite(Date.parse(value)));
}

function isTrade(value: unknown): value is BacktestTrade {
  return (
    isObject(value) &&
    hasOnlyKeys(value, [
      "entry_date",
      "exit_date",
      "direction",
      "entry_price",
      "exit_price",
      "quantity",
      "pnl",
      "return_percent",
    ]) &&
    isPointTime(value.entry_date) &&
    isPointTime(value.exit_date) &&
    (value.direction === "long" || value.direction === "short") &&
    isFiniteNumber(value.entry_price) &&
    value.entry_price > 0 &&
    isFiniteNumber(value.exit_price) &&
    value.exit_price > 0 &&
    isFiniteNumber(value.quantity) &&
    value.quantity > 0 &&
    isFiniteNumber(value.pnl) &&
    isFiniteNumber(value.return_percent)
  );
}

function isTickerResult(value: unknown): value is TickerBacktestResult {
  return (
    isObject(value) &&
    hasOnlyKeys(value, ["ticker", "metrics", "equity_curve", "trades"]) &&
    isTicker(value.ticker) &&
    isMetrics(value.metrics) &&
    Array.isArray(value.equity_curve) &&
    value.equity_curve.length >= 1 &&
    value.equity_curve.every(isEquityPoint) &&
    Array.isArray(value.trades) &&
    value.trades.every(isTrade)
  );
}

export function isBacktestResponse(value: unknown): value is BacktestResponse {
  if (!isObject(value)) return false;
  if (value.status === "error") {
    return hasOnlyKeys(value, ["status", "generated_code", "error"]) && typeof value.generated_code === "string" && isApiError(value.error);
  }
  if (value.status === "complete") {
    return (
      hasOnlyKeys(value, ["status", "strategy_id", "strategy_summary", "generated_code", "warnings", "results"]) &&
      isNonBlank(value.strategy_id) &&
      isNonBlank(value.strategy_summary) &&
      isNonBlank(value.generated_code) &&
      Array.isArray(value.warnings) &&
      value.warnings.every((warning) => typeof warning === "string") &&
      Array.isArray(value.results) &&
      value.results.length >= 1 &&
      value.results.length <= 5 &&
      value.results.every(isTickerResult)
    );
  }
  return false;
}

export function isDeployResponse(value: unknown): value is DeployResponse {
  if (!isObject(value)) return false;
  if (value.status === "error") return hasOnlyKeys(value, ["status", "error"]) && isApiError(value.error);
  return (
    value.status === "active" &&
    hasOnlyKeys(value, ["status", "strategy_id", "active", "next_check_at"]) &&
    isNonBlank(value.strategy_id) &&
    value.active === true &&
    typeof value.next_check_at === "string" &&
    UTC_DATE_TIME_PATTERN.test(value.next_check_at) &&
    Number.isFinite(Date.parse(value.next_check_at))
  );
}

function parseContract<T>(value: unknown, guard: (candidate: unknown) => candidate is T, label: string): T {
  if (!guard(value)) throw new ContractValidationError(`${label} does not match the frozen API contract.`);
  return value;
}

export function parseBacktestRequest(value: unknown): BacktestRequest {
  return parseContract(value, isBacktestRequest, "Backtest request");
}

export function parseBacktestResponse(value: unknown): BacktestResponse {
  return parseContract(value, isBacktestResponse, "Backtest response");
}

export function parseDeployResponse(value: unknown): DeployResponse {
  return parseContract(value, isDeployResponse, "Deploy response");
}
