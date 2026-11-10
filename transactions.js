const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate, requireRole } = require('./auth');
const { moveMoney, HttpError } = require('./ledger');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});

router.use(limiter, authenticate, requireRole('holder'));

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ID_RE = /^[1-9]\d{0,17}$/;
const MAX_AMOUNT = 100000000; // in paise

function parseAmount(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT ? value : null;
}

function parseId(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === 'string' && ID_RE.test(text) ? text : null;
}

function handler(type) {
  return async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key || !KEY_RE.test(key)) {
      return res.status(400).json({
        error: 'Send an Idempotency-Key header of 8 to 64 letters, numbers, - or _.',
      });
    }

    const body = req.body || {};
    const amount = parseAmount(body.amount);
    if (amount === null) {
      return res.status(400).json({
        error: 'amount must be a whole number of paise between 1 and ' + MAX_AMOUNT + '.',
      });
    }

    let fromId = null;
    let toId = null;
    if (type === 'deposit') {
      toId = parseId(body.account_id);
      if (!toId) return res.status(400).json({ error: 'Provide a valid account_id.' });
    } else if (type === 'withdrawal') {
      fromId = parseId(body.account_id);
      if (!fromId) return res.status(400).json({ error: 'Provide a valid account_id.' });
    } else {
      fromId = parseId(body.from_account_id);
      toId = parseId(body.to_account_id);
      if (!fromId || !toId) {
        return res.status(400).json({ error: 'Provide valid from_account_id and to_account_id.' });
      }
      if (fromId === toId) {
        return res.status(400).json({ error: 'Cannot transfer to the same account.' });
      }
    }

    try {
      const out = await moveMoney({ user: req.user, type, fromId, toId, amount, key });
      res.set('Idempotent-Replayed', out.replayed ? 'true' : 'false');
      res.status(out.status).json(out.body);
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ error: err.message });
      }
      throw err;
    }
  };
}

router.post('/deposit', handler('deposit'));
router.post('/withdraw', handler('withdrawal'));
router.post('/transfer', handler('transfer'));

module.exports = router;