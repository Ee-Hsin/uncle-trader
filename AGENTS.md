# Uncle Trading agent rules

## Product and scope

Uncle Trading is a three-hour hackathon MVP. A nontechnical user describes a trading idea, confirms a structured strategy, runs an independent historical backtest for each target ticker, and can mark a tested strategy active in a simulated deployment. Keep the design simple. Do not add real orders, production deployment, authentication, a scheduler, or unrelated features.

## Read before coding

Before you edit code, read:

1. `contracts/README.md`
2. Every schema and example that applies to your work
3. Your workstream prompt in `docs/workstreams/`

`contracts/` is the exact source of truth for field names, nesting, types, allowed values, percentage units, and response shapes. Frontend TypeScript types and backend Pydantic models must match it. No workstream may rename, add, remove, or move a contract field. An agreed contract change must update the affected schemas and examples together.

## Ownership

- William owns `apps/api/**` only.
- Jordan, the project owner, owns `apps/web/app/api/chat/**`, `apps/web/lib/**`, `apps/web/app/page.tsx`, `contracts/**` as contract steward, `prompts/**`, and root web package or environment configuration when needed.
- Sophia owns `apps/web/components/**`, `apps/web/app/globals.css`, and `apps/web/app/ui-preview/**` only.

Do not edit another owner's paths. Preserve all existing changes. Do not commit, push, create branches, create worktrees, or discard changes unless the human explicitly asks.

## Technical boundary

The browser sends only a confirmed contract-valid backtest request to FastAPI, not the conversation transcript. Server-side AI calls use the OpenAI Responses API and model names from environment variables.

Generated strategy source must contain exactly one import-free `Strategy` class with `required_data()` and `generate_signals(data)`. It must use only normalized input rows and built-in Python operations. The backend owns historical data loading, generated-code checks, backtesting, metrics, persistence, and simulated activation.

## Finish each task

Run the checks relevant to the files you own. Report the files changed, checks that passed, checks that could not run, and any integration risk. Do not hide a failed or unavailable check.

