type WorkflowState = "ready" | "waiting" | "placeholder";

const workflow: Array<{ label: string; state: WorkflowState }> = [
  { label: "Describe idea", state: "ready" },
  { label: "Confirm strategy", state: "waiting" },
  { label: "Run backtest", state: "placeholder" },
  { label: "Simulate deploy", state: "placeholder" },
];

const draftStrategy = {
  name: "Treasury trend sample",
  market: "10-year Treasury yield index",
  entry: "Enter when the 20-day average crosses above the 60-day average.",
  exit: "Exit on the reverse crossover.",
};

export function StrategyWorkbench() {
  return (
    <section className="workbench" aria-label="Strategy workflow preview">
      <article className="panel conversation">
        <p className="label">1 · Conversation</p>
        <h2>What would you like to test?</h2>
        <div className="message">
          Describe the market, signal, and exit in your own words. The conversation agent will ask for missing details before it creates a confirmed strategy.
        </div>
        <label htmlFor="idea" className="muted">
          Trading idea
        </label>
        <textarea
          id="idea"
          defaultValue="Buy when short-term Treasury yields begin trending above their longer-term average."
        />
        <div className="actions">
          <span className="muted">Placeholder data only</span>
          <button type="button" disabled>
            Continue
          </button>
        </div>
      </article>

      <article className="panel">
        <p className="label">Workflow</p>
        <ol className="steps">
          {workflow.map((step) => (
            <li key={step.label}>
              <span>{step.label}</span>
              <span className="badge">{step.state}</span>
            </li>
          ))}
        </ol>
      </article>

      <article className="panel">
        <p className="label">2 · Draft strategy</p>
        <h2>{draftStrategy.name}</h2>
        <dl>
          <div className="metric">
            <dt>Market</dt>
            <dd>{draftStrategy.market}</dd>
          </div>
          <div className="metric">
            <dt>Entry</dt>
            <dd>{draftStrategy.entry}</dd>
          </div>
          <div className="metric">
            <dt>Exit</dt>
            <dd>{draftStrategy.exit}</dd>
          </div>
        </dl>
        <div className="statusRow">
          <span className="muted">Backtest metrics will appear after confirmation.</span>
          <button type="button" disabled>
            Deploy
          </button>
        </div>
      </article>
    </section>
  );
}

