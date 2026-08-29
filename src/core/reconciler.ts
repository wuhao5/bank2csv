import { Decimal } from 'decimal.js';
import type { BankAccount, ReconciliationResult } from './types.js';

/**
 * Reconciles account transactions against opening and closing balances using exact Decimal arithmetic.
 */
export function reconcileAccount(account: BankAccount): ReconciliationResult {
  const opening = new Decimal(account.openingBalance ?? 0);
  const closing = new Decimal(account.closingBalance ?? 0);

  let totalCredits = new Decimal(0);
  let totalDebits = new Decimal(0);
  const notes: string[] = [];

  for (const tx of account.transactions) {
    const txAmt = new Decimal(Math.abs(tx.amount));
    if (tx.type === 'CREDIT' || tx.amount > 0) {
      totalCredits = totalCredits.plus(txAmt);
    } else {
      totalDebits = totalDebits.plus(txAmt);
    }
  }

  // Calculated closing = opening + totalCredits - totalDebits
  const calculatedClosing = opening.plus(totalCredits).minus(totalDebits);
  const discrepancy = calculatedClosing.minus(closing);
  const isBalanced = discrepancy.abs().lessThanOrEqualTo(0.01);

  if (account.openingBalance === undefined && account.closingBalance === undefined) {
    notes.push('Statement did not report opening/closing balance; calculated from transaction totals.');
  } else if (!isBalanced) {
    notes.push(
      `Discrepancy detected: Calculated closing is ${calculatedClosing.toFixed(2)} vs reported ${closing.toFixed(2)} (diff: ${discrepancy.toFixed(2)}).`
    );
  } else {
    notes.push(`Balance perfectly reconciled across ${account.transactions.length} transaction(s).`);
  }

  return {
    isBalanced,
    openingBalance: opening.toNumber(),
    closingBalance: closing.toNumber(),
    totalCredits: totalCredits.toNumber(),
    totalDebits: totalDebits.toNumber(),
    calculatedClosingBalance: calculatedClosing.toNumber(),
    discrepancy: discrepancy.toNumber(),
    notes
  };
}

/**
 * Reconciles all accounts in a bank statement.
 */
export function reconcileStatementAccounts(accounts: BankAccount[]): BankAccount[] {
  return accounts.map((acc) => ({
    ...acc,
    reconciliation: reconcileAccount(acc)
  }));
}
