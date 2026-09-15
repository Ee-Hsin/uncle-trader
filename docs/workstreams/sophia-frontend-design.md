# Sophia frontend design workstream prompt

You are implementing the presentational frontend workstream for the Uncle Trading three-hour hackathon MVP. Work in the existing repository checkout. Before you edit anything:

1. Run `git status --short --branch` and preserve every existing change.
2. Read `AGENTS.md`.
3. Read `contracts/README.md`, all four schemas, and all contract examples so the UI can display the correct concepts.
4. Inspect the current components and global CSS before replacing or extending them.

Your ownership is limited to:

- `apps/web/components/**`
- `apps/web/app/globals.css`
- `apps/web/app/ui-preview/**`

Do not edit `apps/web/app/page.tsx`, API routes, `apps/web/lib/**`, `apps/api/**`, `contracts/**`, `prompts/**`, or any package or lock file. Preserve every existing change. Do not commit, push, create a branch, create a worktree, or discard changes unless the human explicitly asks.

## Product and technical boundary

Create the presentational component system for a nontechnical user who turns a trading idea into a confirmed strategy, reviews an independent historical backtest for each ticker, and simulates activation.

Your components must be presentational. Do not call OpenAI, FastAPI, Yahoo Finance, Open-Meteo, or any network service. Do not read environment variables. Do not own application state beyond small local disclosure state such as opening the generated-code panel. Jordan will own page state, network calls, and mapping contract data into your props.

Do not add dependencies. Put UI-only prop and view types in `apps/web/components/types.ts`. These types should describe what the components need to render; they must not become a competing API contract.

## Required UI states

The component system must support these explicit states through props:

- empty idea;
- active conversation;
- missing values;
- proposed values awaiting approval;
- ready for final confirmation;
- backtest loading;
- complete backtest results;
- failure with a clear retry path;
- simulated deployment active with next-check time.

Use a coherent small component set. Suggested components are:

- `StrategyChat`
- `StrategyDraftPanel`
- `EditableStrategyField`
- `ConfirmationPanel`
- `BacktestProgress`
- `BacktestResults`
- `MetricsGrid`
- `EquityCurve`
- `TradeTable`
- `GeneratedCodeDrawer`
- `DeployPanel`
- `StatusBadge`

You can combine components when that makes the interface simpler. Keep props explicit and easy for Jordan to connect.

## Visual direction

Build a restrained, trustworthy dark finance interface:

- use clear information hierarchy and one accent color;
- keep body text and controls high contrast;
- use compact, plain status labels;
- use minimal gradients;
- avoid excessive cards, glows, decoration, and animation;
- do not use fake live-market language, blinking indicators, urgent trading language, or claims of profit;
- label deployment as simulated and results as historical paper-money output.

Before results, make the chat the primary area and place the draft beside it on wide screens. Make missing, proposed, and confirmed values easy to distinguish without relying only on color. Keep the backtest action visibly disabled until final confirmation.

For complete results:

- lead with total return and total P&L;
- show every metric in the current backtest-response contract;
- show the strategy return beside buy-and-hold return;
- render a React SVG equity chart with useful dates, a readable line, and entry/exit markers;
- render the complete trade table;
- provide a clear disclosure control for generated code;
- show warnings without making them look like failures;
- provide the deploy action and the active state with next-check time.

Build the equity chart with React and pure SVG. Do not add a chart package or modify package files.

## Preview route and fixture

Create `apps/web/app/ui-preview/page.tsx` as a clearly labeled development preview. It must not call a network service.

Use mock data that follows the current contracts and is visibly labeled as illustrative. Base it on the contract example:

- target ticker `FICO`;
- Yahoo signal symbol `^TNX`;
- three falling daily close observations;
- long direction;
- five-day holding period;
- 20% allocation;
- $10,000 initial capital.

For visual testing, extend the result view to at least ten equity points and several complete trades while preserving the contract field names, percentage-point units, and internally consistent display values. Provide a simple way in the preview source to render each major state.

## Responsive, accessible, and formatting requirements

- Use semantic headings, landmarks, lists, tables, labels, and buttons.
- Every input needs a visible label. Every icon-only control needs an accessible name.
- Keep keyboard focus visible and navigation order logical.
- Do not use color as the only status signal.
- Meet high contrast for normal text and controls.
- Respect reduced-motion preferences for any small transition.
- On small screens, stack chat, draft, metrics, chart, and table without horizontal page overflow.
- Allow the trade table itself to scroll horizontally when needed.
- Format money with a currency symbol and separators.
- Format percentage-point values with a `%` sign without multiplying by 100.
- Show losses with a minus sign and a text or icon cue in addition to color.
- Format dates for people while keeping exact dates available in accessible text or table cells.
- Render generated code in a scrollable monospace block and never execute it.

## Verification and finish criteria

Follow the existing frontend test conventions. Do not add a UI test framework if none exists.

Run:

- `npm run typecheck:web`
- `npm run build:web`

Start the local preview and visually inspect at a narrow mobile width and a wide desktop width. Check every major state, keyboard focus, chart labels and markers, long content, error text, empty trades, and code overflow. If visual preview tools are unavailable, report that check as not run and still verify the markup and responsive CSS manually.

Finish when the component props can represent every required state, the preview demonstrates those states with contract-shaped mock data, the SVG chart and tables remain readable across screen sizes, and the type check and build pass.

Report the exact files changed, checks that passed, checks that could not run, accessibility or responsive limits, and the prop mapping Jordan must provide. Do not commit unless the human asks.

