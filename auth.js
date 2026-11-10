require('dotenv').config();
const jwt = require('jsonwebtoken');
const pool = require('./db');

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long');
}

function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, secret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Login required.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  const result = await pool.query(
    'SELECT id, email, role FROM users WHERE id = $1',
    [payload.sub]
  );
  if (!result.rows[0]) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  req.user = result.rows[0];
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You are not allowed to do this.' });
    }
    next();
  };
}

module.exports = { signToken, authenticate, requireRole };