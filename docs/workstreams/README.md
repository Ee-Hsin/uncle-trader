# Concurrent work guide

Each person should copy the full contents of their own workstream file and use it as the first prompt to their coding agent:

- William: [`william-backend.md`](william-backend.md)
- Jordan: [`jordan-agent-integration.md`](jordan-agent-integration.md)
- Sophia: [`sophia-frontend-design.md`](sophia-frontend-design.md)

The prompts are complete and do not depend on earlier chat history.

## Start from one baseline

All three people must start from the exact same baseline commit. The prepared repository is not committed automatically; the humans choose when the baseline is ready and when to commit it.

Recommended future branch names are:

- `william/backend`
- `jordan/agent-integration`
- `sophia/frontend-design`

These are recommendations only. This setup task does not create them.

Never run three coding agents in the same working directory. Use separate laptops or clones, or use a separate worktree for each person after the baseline is committed. This prevents one agent from overwriting another agent's uncommitted files.

The files in `contracts/` are frozen and are the shared interface boundary. Each workstream implements against them. If a contract problem appears, stop and ask Jordan to coordinate one agreed change.

## Integration order

1. Jordan publishes the baseline contract and TypeScript types if they are needed by the other workstreams.
2. William implements the backend contract.
3. Sophia implements the presentational components.
4. Jordan integrates the conversation route, backend calls, and Sophia's component props.
5. Stop adding features and use the remaining time for end-to-end testing and fixes.

## Fast checkpoint

Reach this checkpoint before adding optional work:

1. The backend returns a fixture that exactly matches the response contract.
2. The UI works against a mock that exactly matches the same contract.
3. The conversation agent produces a request that validates against the request contract.
4. Replace the fixtures with the live path and run one end-to-end test.

