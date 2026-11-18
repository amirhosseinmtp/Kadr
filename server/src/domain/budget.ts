export interface BudgetAmounts {
  estimatedAmount: number;
  committedAmount: number;
  actualAmount: number;
}

export function summarizeBudget(items: BudgetAmounts[]) {
  const totals = items.reduce((summary, item) => ({
    estimated: summary.estimated + item.estimatedAmount,
    committed: summary.committed + item.committedAmount,
    actual: summary.actual + item.actualAmount,
  }), { estimated: 0, committed: 0, actual: 0 });
  if (!Object.values(totals).every(Number.isSafeInteger)) throw new RangeError('Budget total exceeds safe integer precision.');
  return { ...totals, variance: totals.estimated - totals.actual };
}
