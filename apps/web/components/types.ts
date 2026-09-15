export type FieldState = "missing" | "proposed" | "confirmed";

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type EditableField = {
  id: string;
  label: string;
  value: string;
  state: FieldState;
  helperText?: string;
};

export type StrategyDraftView = {
  name: string;
  thesis: string;
  targetTickers: string[];
  direction: "long" | "short";
  signalSource: "yahoo" | "open_meteo";
  signalSymbol?: string;
  signalField: string;
  signalRule: string;
  parameters: Array<{ label: string; value: string }>;
  execution: {
    entryTiming: string;
    holdingPeriodDays: number;
    allocationPercent: number;
    ignoreOverlappingSignals: boolean;
  };
  fields: EditableField[];
};

export type Metric = {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
};

export type EquityPoint = {
  date: string;
  equity: number;
};

export type Trade = {
  entry_date: string;
  exit_date: string;
  direction: "long" | "short";
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl: number;
  return_percent: number;
};

export type TickerBacktestResult = {
  ticker: string;
  metrics: Metric[];
  headlineMetrics: Metric[];
  equityCurve: EquityPoint[];
  trades: Trade[];
};

export type BacktestResultsView = {
  strategyId: string;
  strategySummary: string;
  generatedCode: string;
  warnings: string[];
  results: TickerBacktestResult[];
};

export type DeployView =
  | {
      state: "idle";
      disabled?: boolean;
      helperText: string;
    }
  | {
      state: "loading";
      helperText: string;
    }
  | {
      state: "active";
      strategyId: string;
      nextCheckAt: string;
    }
  | {
      state: "error";
      message: string;
    };

export type WorkbenchStage =
  | "empty"
  | "conversation"
  | "missing"
  | "proposed"
  | "ready"
  | "loading"
  | "complete"
  | "failure"
  | "active";

export type StrategyWorkbenchProps = {
  stage: WorkbenchStage;
  messages: ConversationMessage[];
  idea: string;
  layout?: "dashboard" | "workflow";
  draft?: StrategyDraftView;
  missingFields?: string[];
  results?: BacktestResultsView;
  deploy?: DeployView;
  error?: {
    title: string;
    message: string;
  };
  illustrative?: boolean;
};
