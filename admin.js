const express = require('express');
const pool = require('./db');
const { authenticate, requireRole } = require('./auth');

const router = express.Router();
router.use(authenticate);

router.get('/reconcile', requireRole('admin', 'auditor'), async (req, res) => {
  const ledger = await pool.query(
    'SELECT COALESCE(SUM(amount), 0)::text AS total FROM ledger_entries'
  );
  const balances = await pool.query(
    'SELECT COALESCE(SUM(balance), 0)::text AS total FROM accounts'
  );
  const mismatched = await pool.query(
    `SELECT a.id, a.balance::text AS stored_balance,
            COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE account_id = a.id), 0)::text AS ledger_balance
       FROM accounts a
      WHERE a.balance <> COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE account_id = a.id), 0)
      ORDER BY a.id`
  );
  const unbalanced = await pool.query(
    `SELECT transaction_id, SUM(amount)::text AS total
       FROM ledger_entries
      GROUP BY transaction_id
     HAVING SUM(amount) <> 0
      ORDER BY transaction_id`
  );

  const ledgerTotal = ledger.rows[0].total;
  const balanceTotal = balances.rows[0].total;
  res.json({
    ok:
      ledgerTotal === '0' &&
      balanceTotal === '0' &&
      mismatched.rows.length === 0 &&
      unbalanced.rows.length === 0,
    ledger_total: ledgerTotal,
    balance_total: balanceTotal,
    mismatched_accounts: mismatched.rows,
    unbalanced_transactions: unbalanced.rows,
  });
});

router.get('/audit', requireRole('admin', 'auditor'), async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const result = await pool.query(
    'SELECT id, actor_id, action, details, created_at FROM audit_log ORDER BY id DESC LIMIT $1',
    [limit]
  );
  res.json(result.rows);
});

router.get('/users', requireRole('admin'), async (req, res) => {
  const result = await pool.query(
    'SELECT id, email, role, created_at FROM users ORDER BY id LIMIT 200'
  );
  res.json(result.rows);
});

module.exports = router;