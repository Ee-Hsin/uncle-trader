# Uncle Trading

Uncle Trading is a three-hour hackathon MVP. A nontechnical user describes a trading idea, confirms a structured strategy, runs historical paper-money backtests, and can mark a tested strategy active in a simulated deployment.

The repository is still a starter. The current backtest and deploy routes return HTTP 501 placeholders until their workstreams implement them.

## Start here

- [Project agent rules](AGENTS.md)
- [Frozen API contract policy](contracts/README.md)
- [Concurrent work guide](docs/workstreams/README.md)
- [William backend prompt](docs/workstreams/william-backend.md)
- [Jordan agent and integration prompt](docs/workstreams/jordan-agent-integration.md)
- [Sophia frontend design prompt](docs/workstreams/sophia-frontend-design.md)

`prompts/` contains runtime instructions that the application will send to AI models. `docs/workstreams/` contains human-to-coding-agent prompts used to build the application.

## Repository map and ownership

- William owns `apps/api/**`: FastAPI, trusted data clients, generated-code checks, independent backtests, metrics, SQLite, and simulated activation.
- Jordan owns `apps/web/app/api/chat/**`, `apps/web/lib/**`, `apps/web/app/page.tsx`, `prompts/**`, contract stewardship, and web integration configuration.
- Sophia owns `apps/web/components/**`, `apps/web/app/globals.css`, and `apps/web/app/ui-preview/**`: presentational components, styling, and visual previews.
- `contracts/` is the fixed interface boundary. Its schemas and examples are the exact source of truth, not loose guidance.

See [AGENTS.md](AGENTS.md) for the complete path restrictions.

## Local setup

Requirements: Node.js 20.9 or newer and Python 3.11 or newer.

Web:

```sh
cp apps/web/.env.example apps/web/.env.local
npm install
npm run dev:web
```

Open `http://localhost:3000`.

API:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r apps/api/requirements.txt
cp apps/api/.env.example apps/api/.env
set -a
source apps/api/.env
set +a
uvicorn app.main:app --app-dir apps/api --reload
```

Until William adds automatic `.env` loading, source `apps/api/.env` into each new terminal before starting Uvicorn. Open `http://localhost:8000/health` to check the service.

The root `.env.example` lists all variables for reference. AI keys and model names stay server-side. The web app reads only `NEXT_PUBLIC_API_BASE_URL` in browser code.

## Hackathon start

1. Review this prepared baseline. Commit it only when the humans decide it is ready.
2. Have every person branch or check out from that exact same commit.
3. Copy the full contents of your own workstream prompt into your coding agent.
4. Keep workstream paths separate. Never run three coding agents in the same working directory.
5. Reach the first integration checkpoint with a contract-shaped backend fixture, a contract-shaped UI mock, and a contract-valid agent request.
6. Replace fixtures with the live path, then stop adding features and test the full flow.

Generated strategy code must contain exactly one import-free `Strategy` class with `required_data()` and `generate_signals(data)`. Do not run model-generated code without the backend's checker and time-limited isolation.

