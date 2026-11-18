import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeBudget } from './budget.js';

test('sums estimate, commitments, and actual costs without conflating them', () => {
  assert.deepEqual(summarizeBudget([
    { estimatedAmount: 1200, committedAmount: 800, actualAmount: 500 },
    { estimatedAmount: 300, committedAmount: 300, actualAmount: 420 },
  ]), { estimated: 1500, committed: 1100, actual: 920, variance: 580 });
});

test('reports overspend as a negative variance and rejects unsafe totals', () => {
  assert.equal(summarizeBudget([{ estimatedAmount: 100, committedAmount: 100, actualAmount: 130 }]).variance, -30);
  assert.throws(() => summarizeBudget([{ estimatedAmount: Number.MAX_SAFE_INTEGER, committedAmount: 0, actualAmount: 0 }, { estimatedAmount: 1, committedAmount: 0, actualAmount: 0 }]), RangeError);
});
