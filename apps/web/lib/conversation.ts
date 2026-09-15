import {
  ContractValidationError,
  type BacktestRequest,
  type Direction,
  type SignalField,
  type SignalParameter,
  type SignalSource,
  parseBacktestRequest,
} from "./contracts";

export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
}

export const CHAT_MESSAGE_MAX_CHARS = 4_000;
export const CHAT_HISTORY_MAX_CHARS = 32_000;
export const CHAT_HISTORY_MAX_MESSAGES = 20;

export function conversationMessagesForRequest(
  messages: readonly ConversationMessage[],
): ConversationMessage[] {
  const selected: ConversationMessage[] = [];
  let characterCount = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (selected.length >= CHAT_HISTORY_MAX_MESSAGES) break;
    if (characterCount + message.content.length > CHAT_HISTORY_MAX_CHARS) break;
    selected.push(message);
    characterCount += message.content.length;
  }

  return selected.reverse();
}

export interface DraftLocation {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
}

export interface DraftParameters {
  threshold: SignalParameter | null;
  consecutive_observations: number | null;
  lookback_days: number | null;
  observation_frequency: string | null;
  comparison_window_days: number | null;
}

export interface ConversationDraft {
  strategy: {
    version: "1.0" | null;
    name: string | null;
    thesis: string | null;
    target_tickers: string[] | null;
    direction: Direction | null;
    signal: {
      source: SignalSource | null;
      symbol: string | null;
      field: SignalField | null;
      location: DraftLocation | null;
      rule: string | null;
      parameters: DraftParameters;
    };
    execution: {
      entry_timing: "next_trading_day_close" | null;
      holding_period_days: number | null;
      allocation_percent: number | null;
      ignore_overlapping_signals: true | null;
    };
  };
  backtest: {
    start_date: string | null;
    end_date: string | null;
    initial_capital: number | null;
  };
}

export interface ConversationTurn {
  assistant_message: string;
  strategy_draft: ConversationDraft;
  missing_fields: string[];
  confirmed_field_paths: string[];
  proposed_field_paths: string[];
  ready_for_confirmation: boolean;
}

export const DEFAULT_CONFIRMED_FIELD_PATHS = [
  "strategy.version",
  "strategy.execution.entry_timing",
  "strategy.execution.ignore_overlapping_signals",
  "strategy.signal.parameters.observation_frequency",
] as const;

const COMMON_REQUIRED_PATHS = [
  "strategy.version",
  "strategy.name",
  "strategy.thesis",
  "strategy.target_tickers",
  "strategy.direction",
  "strategy.signal.source",
  "strategy.signal.field",
  "strategy.signal.rule",
  "strategy.execution.entry_timing",
  "strategy.execution.holding_period_days",
  "strategy.execution.allocation_percent",
  "strategy.execution.ignore_overlapping_signals",
  "backtest.start_date",
  "backtest.end_date",
  "backtest.initial_capital",
] as const;

const LOCATION_PATHS = [
  "strategy.signal.location.name",
  "strategy.signal.location.latitude",
  "strategy.signal.location.longitude",
  "strategy.signal.location.timezone",
] as const;

const PARAMETER_PATHS = [
  "strategy.signal.parameters.threshold",
  "strategy.signal.parameters.consecutive_observations",
  "strategy.signal.parameters.lookback_days",
  "strategy.signal.parameters.observation_frequency",
  "strategy.signal.parameters.comparison_window_days",
] as const;

const DRAFT_FIELD_PATHS = [
  ...COMMON_REQUIRED_PATHS,
  ...LOCATION_PATHS,
  ...PARAMETER_PATHS,
  "strategy.signal.symbol",
] as const;

const ALL_DRAFT_PATHS = new Set<string>(DRAFT_FIELD_PATHS);

export const conversationTurnSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "assistant_message",
    "strategy_draft",
    "missing_fields",
    "confirmed_field_paths",
    "proposed_field_paths",
    "ready_for_confirmation",
  ],
  properties: {
    assistant_message: { type: "string", minLength: 1 },
    strategy_draft: {
      type: "object",
      additionalProperties: false,
      required: ["strategy", "backtest"],
      properties: {
        strategy: {
          type: "object",
          additionalProperties: false,
          required: ["version", "name", "thesis", "target_tickers", "direction", "signal", "execution"],
          properties: {
            version: { enum: ["1.0", null] },
            name: { type: ["string", "null"] },
            thesis: { type: ["string", "null"] },
            target_tickers: {
              anyOf: [
                { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
                { type: "null" },
              ],
            },
            direction: { enum: ["long", "short", null] },
            signal: {
              type: "object",
              additionalProperties: false,
              required: ["source", "symbol", "field", "location", "rule", "parameters"],
              properties: {
                source: { enum: ["yahoo", "open_meteo", null] },
                symbol: { type: ["string", "null"] },
                field: {
                  enum: ["close", "volume", "precipitation_sum", "temperature_2m_max", "temperature_2m_min", null],
                },
                location: {
                  anyOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["name", "latitude", "longitude", "timezone"],
                      properties: {
                        name: { type: ["string", "null"] },
                        latitude: { type: ["number", "null"] },
                        longitude: { type: ["number", "null"] },
                        timezone: { type: ["string", "null"] },
                      },
                    },
                    { type: "null" },
                  ],
                },
                rule: { type: ["string", "null"] },
                parameters: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "threshold",
                    "consecutive_observations",
                    "lookback_days",
                    "observation_frequency",
                    "comparison_window_days",
                  ],
                  properties: {
                    threshold: { type: ["string", "number", "boolean", "null"] },
                    consecutive_observations: { type: ["integer", "null"] },
                    lookback_days: { type: ["integer", "null"] },
                    observation_frequency: { type: ["string", "null"] },
                    comparison_window_days: { type: ["integer", "null"] },
                  },
                },
              },
            },
            execution: {
              type: "object",
              additionalProperties: false,
              required: ["entry_timing", "holding_period_days", "allocation_percent", "ignore_overlapping_signals"],
              properties: {
                entry_timing: { enum: ["next_trading_day_close", null] },
                holding_period_days: { type: ["integer", "null"] },
                allocation_percent: { type: ["number", "null"] },
                ignore_overlapping_signals: { enum: [true, null] },
              },
            },
          },
        },
        backtest: {
          type: "object",
          additionalProperties: false,
          required: ["start_date", "end_date", "initial_capital"],
          properties: {
            start_date: { type: ["string", "null"] },
            end_date: { type: ["string", "null"] },
            initial_capital: { type: ["number", "null"] },
          },
        },
      },
    },
    missing_fields: { type: "array", items: { type: "string", enum: DRAFT_FIELD_PATHS } },
    confirmed_field_paths: { type: "array", items: { type: "string", enum: DRAFT_FIELD_PATHS } },
    proposed_field_paths: { type: "array", items: { type: "string", enum: DRAFT_FIELD_PATHS } },
    ready_for_confirmation: { type: "boolean" },
  },
};

export function createEmptyDraft(): ConversationDraft {
  return {
    strategy: {
      version: "1.0",
      name: null,
      thesis: null,
      target_tickers: null,
      direction: null,
      signal: {
        source: null,
        symbol: null,
        field: null,
        location: null,
        rule: null,
        parameters: {
          threshold: null,
          consecutive_observations: null,
          lookback_days: null,
          observation_frequency: "daily",
          comparison_window_days: null,
        },
      },
      execution: {
        entry_timing: "next_trading_day_close",
        holding_period_days: null,
        allocation_percent: null,
        ignore_overlapping_signals: true,
      },
    },
    backtest: { start_date: null, end_date: null, initial_capital: null },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function nullableInteger(value: unknown): value is number | null {
  return value === null || Number.isInteger(value);
}

export function isConversationDraft(value: unknown): value is ConversationDraft {
  if (!isObject(value) || !exactKeys(value, ["strategy", "backtest"])) return false;
  const strategy = value.strategy;
  const backtest = value.backtest;
  if (
    !isObject(strategy) ||
    !exactKeys(strategy, ["version", "name", "thesis", "target_tickers", "direction", "signal", "execution"]) ||
    !isObject(backtest) ||
    !exactKeys(backtest, ["start_date", "end_date", "initial_capital"])
  ) {
    return false;
  }
  const signal = strategy.signal;
  const execution = strategy.execution;
  if (
    !isObject(signal) ||
    !exactKeys(signal, ["source", "symbol", "field", "location", "rule", "parameters"]) ||
    !isObject(execution) ||
    !exactKeys(execution, ["entry_timing", "holding_period_days", "allocation_percent", "ignore_overlapping_signals"])
  ) {
    return false;
  }
  const parameters = signal.parameters;
  if (
    !isObject(parameters) ||
    !exactKeys(parameters, [
      "threshold",
      "consecutive_observations",
      "lookback_days",
      "observation_frequency",
      "comparison_window_days",
    ])
  ) {
    return false;
  }
  const location = signal.location;
  const locationValid =
    location === null ||
    (isObject(location) &&
      exactKeys(location, ["name", "latitude", "longitude", "timezone"]) &&
      nullableString(location.name) &&
      nullableNumber(location.latitude) &&
      nullableNumber(location.longitude) &&
      nullableString(location.timezone));
  return (
    (strategy.version === "1.0" || strategy.version === null) &&
    nullableString(strategy.name) &&
    nullableString(strategy.thesis) &&
    (strategy.target_tickers === null ||
      (Array.isArray(strategy.target_tickers) && strategy.target_tickers.every((item) => typeof item === "string"))) &&
    (strategy.direction === null || strategy.direction === "long" || strategy.direction === "short") &&
    (signal.source === null || signal.source === "yahoo" || signal.source === "open_meteo") &&
    nullableString(signal.symbol) &&
    (signal.field === null ||
      signal.field === "close" ||
      signal.field === "volume" ||
      signal.field === "precipitation_sum" ||
      signal.field === "temperature_2m_max" ||
      signal.field === "temperature_2m_min") &&
    locationValid &&
    nullableString(signal.rule) &&
    (parameters.threshold === null ||
      typeof parameters.threshold === "string" ||
      typeof parameters.threshold === "boolean" ||
      (typeof parameters.threshold === "number" && Number.isFinite(parameters.threshold))) &&
    nullableInteger(parameters.consecutive_observations) &&
    nullableInteger(parameters.lookback_days) &&
    nullableString(parameters.observation_frequency) &&
    nullableInteger(parameters.comparison_window_days) &&
    (execution.entry_timing === null || execution.entry_timing === "next_trading_day_close") &&
    nullableInteger(execution.holding_period_days) &&
    nullableNumber(execution.allocation_percent) &&
    (execution.ignore_overlapping_signals === null || execution.ignore_overlapping_signals === true) &&
    nullableString(backtest.start_date) &&
    nullableString(backtest.end_date) &&
    nullableNumber(backtest.initial_capital)
  );
}

export function isDraftFieldPath(path: unknown): path is string {
  return typeof path === "string" && ALL_DRAFT_PATHS.has(path);
}

export function parseConversationTurn(value: unknown): ConversationTurn {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "assistant_message",
      "strategy_draft",
      "missing_fields",
      "confirmed_field_paths",
      "proposed_field_paths",
      "ready_for_confirmation",
    ]) ||
    typeof value.assistant_message !== "string" ||
    !value.assistant_message.trim() ||
    !isConversationDraft(value.strategy_draft) ||
    !Array.isArray(value.missing_fields) ||
    !value.missing_fields.every(isDraftFieldPath) ||
    !Array.isArray(value.confirmed_field_paths) ||
    !value.confirmed_field_paths.every(isDraftFieldPath) ||
    !Array.isArray(value.proposed_field_paths) ||
    !value.proposed_field_paths.every(isDraftFieldPath) ||
    typeof value.ready_for_confirmation !== "boolean"
  ) {
    throw new ContractValidationError("The conversation response did not match its structured output schema.");
  }
  return value as unknown as ConversationTurn;
}

export function requiredDraftPaths(draft: ConversationDraft): string[] {
  if (draft.strategy.signal.source === "yahoo") return [...COMMON_REQUIRED_PATHS, "strategy.signal.symbol"];
  if (draft.strategy.signal.source === "open_meteo") return [...COMMON_REQUIRED_PATHS, ...LOCATION_PATHS];
  return [...COMMON_REQUIRED_PATHS];
}

export function readDraftPath(draft: ConversationDraft, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => {
    if (!isObject(value)) return undefined;
    return value[part];
  }, draft);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0 && value.every(hasMeaningfulValue);
  return true;
}

export function missingDraftPaths(draft: ConversationDraft): string[] {
  return requiredDraftPaths(draft).filter((path) => !hasMeaningfulValue(readDraftPath(draft, path)));
}

export function populatedDraftPaths(draft: ConversationDraft): string[] {
  return [...requiredDraftPaths(draft), ...PARAMETER_PATHS].filter((path) => hasMeaningfulValue(readDraftPath(draft, path)));
}

export function proposedDraftPaths(draft: ConversationDraft, confirmedPaths: readonly string[]): string[] {
  const confirmed = new Set(confirmedPaths);
  return populatedDraftPaths(draft).filter((path) => !confirmed.has(path));
}

export function updateDraftPath(draft: ConversationDraft, path: string, value: unknown): ConversationDraft {
  const copy = structuredClone(draft) as ConversationDraft;
  const parts = path.split(".");
  let target: Record<string, unknown> = copy as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(target[part])) target[part] = {};
    target = target[part] as Record<string, unknown>;
  }
  target[parts.at(-1) as string] = value;
  return copy;
}

export function draftFromBacktestRequest(request: BacktestRequest): ConversationDraft {
  const parameters: DraftParameters = {
    threshold: null,
    consecutive_observations: null,
    lookback_days: null,
    observation_frequency: null,
    comparison_window_days: null,
  };
  for (const key of Object.keys(parameters) as Array<keyof DraftParameters>) {
    const value = request.strategy.signal.parameters[key];
    if (value !== undefined) parameters[key] = value as never;
  }
  return {
    strategy: {
      version: request.strategy.version,
      name: request.strategy.name,
      thesis: request.strategy.thesis,
      target_tickers: request.strategy.target_tickers,
      direction: request.strategy.direction,
      signal: {
        source: request.strategy.signal.source,
        symbol: request.strategy.signal.symbol ?? null,
        field: request.strategy.signal.field,
        location: request.strategy.signal.location ?? null,
        rule: request.strategy.signal.rule,
        parameters,
      },
      execution: request.strategy.execution,
    },
    backtest: request.backtest,
  };
}

export function backtestRequestFromDraft(draft: ConversationDraft): BacktestRequest {
  const { strategy, backtest } = draft;
  const parameters = Object.fromEntries(
    Object.entries(strategy.signal.parameters).filter((entry): entry is [string, SignalParameter] => entry[1] !== null),
  );
  const signal =
    strategy.signal.source === "yahoo"
      ? {
          source: "yahoo" as const,
          symbol: strategy.signal.symbol,
          field: strategy.signal.field,
          rule: strategy.signal.rule,
          parameters,
        }
      : {
          source: "open_meteo" as const,
          field: strategy.signal.field,
          location: strategy.signal.location,
          rule: strategy.signal.rule,
          parameters,
        };
  return parseBacktestRequest({
    strategy: {
      version: strategy.version,
      name: strategy.name,
      thesis: strategy.thesis,
      target_tickers: strategy.target_tickers,
      direction: strategy.direction,
      signal,
      execution: strategy.execution,
    },
    backtest,
  });
}

export function confirmationIssues(draft: ConversationDraft, confirmedPaths: readonly string[]): {
  missing: string[];
  proposed: string[];
  contractError: string | null;
} {
  const missing = missingDraftPaths(draft);
  const proposed = proposedDraftPaths(draft, confirmedPaths);
  let contractError: string | null = null;
  if (missing.length === 0 && proposed.length === 0) {
    try {
      backtestRequestFromDraft(draft);
    } catch (error) {
      contractError = error instanceof Error ? error.message : "The draft is invalid.";
    }
  }
  return { missing, proposed, contractError };
}

export function confirmedBacktestRequestFromDraft(
  draft: ConversationDraft,
  confirmedPaths: readonly string[],
): BacktestRequest {
  const issues = confirmationIssues(draft, confirmedPaths);
  if (issues.missing.length > 0) {
    throw new ContractValidationError("Every required field must be complete before confirmation.");
  }
  if (issues.proposed.length > 0) {
    throw new ContractValidationError("Every proposed value must be accepted or edited before confirmation.");
  }
  if (issues.contractError) throw new ContractValidationError(issues.contractError);
  return backtestRequestFromDraft(draft);
}
