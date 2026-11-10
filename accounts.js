const express = require('express');
const pool = require('./db');
const { authenticate, requireRole } = require('./auth');
const { logAudit } = require('./audit');

const router = express.Router();
router.use(authenticate);

const MAX_ACCOUNTS = 5;
const ID_RE = /^[1-9]\d{0,17}$/;

async function loadAccountFor(user, idText) {
  if (!ID_RE.test(idText)) return { status: 400 };
  const result = await pool.query(
    'SELECT id, owner_id, name, balance, created_at FROM accounts WHERE id = $1',
    [idText]
  );
  const account = result.rows[0];
  if (!account) return { status: 404 };
  const isStaff = user.role === 'admin' || user.role === 'auditor';
  const isOwner = account.owner_id !== null && String(account.owner_id) === String(user.id);
  if (!isStaff && !isOwner) return { status: 404 };
  return { account };
}

router.post('/', requireRole('holder'), async (req, res) => {
  const name = req.body && req.body.name;
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 60) {
    return res.status(400).json({ error: 'Provide an account name of 1 to 60 characters.' });
  }

  const count = await pool.query(
    'SELECT count(*)::int AS n FROM accounts WHERE owner_id = $1',
    [req.user.id]
  );
  if (count.rows[0].n >= MAX_ACCOUNTS) {
    return res.status(409).json({ error: 'Account limit reached.' });
  }

  const result = await pool.query(
    'INSERT INTO accounts (owner_id, name) VALUES ($1, $2) RETURNING id, name, balance, created_at',
    [req.user.id, name.trim()]
  );
  const account = result.rows[0];
  await logAudit(pool, req.user.id, 'account_created', { account_id: account.id });
  res.status(201).json(account);
});

router.get('/', async (req, res) => {
  const isStaff = req.user.role === 'admin' || req.user.role === 'auditor';
  const result = isStaff
    ? await pool.query('SELECT id, owner_id, name, balance, created_at FROM accounts ORDER BY id LIMIT 200')
    : await pool.query(
        'SELECT id, name, balance, created_at FROM accounts WHERE owner_id = $1 ORDER BY id',
        [req.user.id]
      );
  res.json(result.rows);
});

router.get('/:id', async (req, res) => {
  const found = await loadAccountFor(req.user, req.params.id);
  if (found.status === 400) return res.status(400).json({ error: 'Invalid account id.' });
  if (found.status) return res.status(404).json({ error: 'Account not found.' });
  res.json(found.account);
});

router.get('/:id/entries', async (req, res) => {
  const found = await loadAccountFor(req.user, req.params.id);
  if (found.status === 400) return res.status(400).json({ error: 'Invalid account id.' });
  if (found.status) return res.status(404).json({ error: 'Account not found.' });

  const result = await pool.query(
    `SELECT le.id, le.transaction_id, t.type, le.amount, le.created_at
       FROM ledger_entries le
       JOIN transactions t ON t.id = le.transaction_id
      WHERE le.account_id = $1
      ORDER BY le.id DESC
      LIMIT 100`,
    [found.account.id]
  );
  res.json(result.rows);
});

module.exports = router;