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
  input?: "text" | "number" | "date" | "select";
  options?: Array<{ label: string; value: string }>;
};

export type StrategyDraftView = {
  name: string;
  thesis: string;
  targetTickers: string[];
  direction: "long" | "short" | null;
  signalSource: "yahoo" | "open_meteo" | null;
  signalSymbol?: string;
  signalField: string;
  signalRule: string;
  parameters: Array<{ label: string; value: string }>;
  execution: {
    entryTiming: string;
    holdingPeriodDays: number | null;
    allocationPercent: number | null;
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
  chatLoading?: boolean;
  chatError?: string;
  finalConfirmed?: boolean;
  hasProposals?: boolean;
  onIdeaChange?: (value: string) => void;
  onSubmitIdea?: (value?: string) => void;
  onFieldChange?: (fieldId: string, value: string) => void;
  onAcceptProposals?: () => void;
  onConfirm?: () => void;
  onRunBacktest?: () => void;
  onRetryBacktest?: () => void;
  onDeploy?: () => void;
};

export type StrategyRecord = {
  id: string;
  name: string;
  ticker: string;
  status: "paper" | "draft";
  returnPercent: number;
  pnl: number;
  lastRun: string;
  summary: string;
  equityCurve: EquityPoint[];
  pnlCurve: Array<{ date: string; value: number }>;
};
