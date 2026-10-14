-- The display scale is now 10x: 10 microdollars per Credit. Account balances,
-- ledger deltas and purchase snapshots already use microdollars and stay intact.
comment on column users.credits_balance is 'Integer microdollars; 10 units = 1 displayed Credit';
comment on column credit_ledger.delta is 'Signed integer microdollars; 10 units = 1 displayed Credit';
