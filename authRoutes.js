const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('./db');
const { signToken } = require('./auth');
const { logAudit } = require('./audit');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

function readCredentials(body, strict) {
  const { email, password } = body || {};
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail.length > 254 || !EMAIL_RE.test(cleanEmail)) return null;
  if (Buffer.byteLength(password) > 72) return null;
  if (strict && password.length < 10) return null;
  return { email: cleanEmail, password };
}

router.post('/register', authLimiter, async (req, res) => {
  const creds = readCredentials(req.body, true);
  if (!creds) {
    return res
      .status(400)
      .json({ error: 'Provide a valid email and a password of 10 to 72 characters.' });
  }

  const hash = await bcrypt.hash(creds.password, 12);
  try {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'holder')
       RETURNING id, email, role`,
      [creds.email, hash]
    );
    const user = result.rows[0];
    await logAudit(pool, user.id, 'user_registered', { email: user.email });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered.' });
    }
    throw err;
  }
});

router.post('/login', authLimiter, async (req, res) => {
  const creds = readCredentials(req.body, false);
  if (!creds) {
    return res.status(400).json({ error: 'Provide email and password.' });
  }

  const result = await pool.query(
    'SELECT id, email, role, password_hash FROM users WHERE email = $1',
    [creds.email]
  );
  const user = result.rows[0];

  const passwordOk = await bcrypt.compare(
    creds.password,
    user ? user.password_hash : DUMMY_HASH
  );

  if (!user || !passwordOk) {
    await logAudit(pool, user ? user.id : null, 'login_failed', { email: creds.email });
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  await logAudit(pool, user.id, 'login_success', {});
  res.json({
    token: signToken(user.id),
    user: { id: user.id, email: user.email, role: user.role },
  });
});

module.exports = router;