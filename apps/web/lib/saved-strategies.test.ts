import assert from "node:assert/strict";
import test from "node:test";
import { backtestRequestFixture, backtestResponseFixture } from "./fixtures";
import {
  SAVED_STRATEGIES_KEY,
  loadSavedStrategies,
  mergeSavedStrategies,
  storeSavedStrategies,
  strategyRecordFromDeployment,
  upsertSavedStrategy,
} from "./saved-strategies";

test("a deployed backtest becomes a saved strategy record", () => {
  assert.equal(backtestResponseFixture.status, "complete");
  if (backtestResponseFixture.status !== "complete") return;

  const record = strategyRecordFromDeployment(backtestRequestFixture, backtestResponseFixture);

  assert.equal(record.id, backtestResponseFixture.strategy_id);
  assert.equal(record.name, backtestRequestFixture.strategy.name);
  assert.equal(record.status, "active");
  assert.equal(record.pnl, backtestResponseFixture.results[0].metrics.total_pnl);
  assert.equal(record.equityCurve.length, backtestResponseFixture.results[0].equity_curve.length);
  assert.deepEqual(record.deployment, { pnl: 0, pnlCurve: [] });
});

test("saved strategies are kept across reloads and replace older copies", () => {
  assert.equal(backtestResponseFixture.status, "complete");
  if (backtestResponseFixture.status !== "complete") return;
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  const record = strategyRecordFromDeployment(backtestRequestFixture, backtestResponseFixture);
  const updated = upsertSavedStrategy([{ ...record, name: "Old name" }], record);

  storeSavedStrategies(storage, updated);

  assert.equal(updated.length, 1);
  assert.equal(loadSavedStrategies(storage)[0].name, record.name);
  assert.ok(values.has(SAVED_STRATEGIES_KEY));
  assert.deepEqual(mergeSavedStrategies(updated, [{ ...record, name: "Default name" }]), updated);
});

test("the obsolete Tesla Three-Day Dip sidebar entry is removed once", () => {
  assert.equal(backtestResponseFixture.status, "complete");
  if (backtestResponseFixture.status !== "complete") return;
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  const record = strategyRecordFromDeployment(backtestRequestFixture, backtestResponseFixture);
  const oldTesla = { ...record, id: "tesla-three-day-dip", name: "Tesla Three-Day Dip" };
  const otherTesla = { ...record, id: "tesla-three-day-decline", name: "Tesla Three-Day Decline Rebound" };
  storage.setItem(SAVED_STRATEGIES_KEY, JSON.stringify([oldTesla, otherTesla]));

  assert.deepEqual(loadSavedStrategies(storage).map((strategy) => strategy.name), [otherTesla.name]);

  storeSavedStrategies(storage, [oldTesla, otherTesla]);
  assert.equal(loadSavedStrategies(storage).length, 2);
});
