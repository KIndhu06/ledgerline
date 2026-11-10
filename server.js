require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const pool = require('./db');
const authRoutes = require('./authRoutes');
const accountRoutes = require('./accounts');
const transactionRoutes = require('./transactions');
const { authenticate, requireRole } = require('./auth');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ status: 'error', database: 'unreachable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);

app.get('/api/me', authenticate, (req, res) => {
  res.json(req.user);
});

// Temporary route used only to test role checks. We delete it later.
app.get('/api/admin/ping', authenticate, requireRole('admin'), (req, res) => {
  res.json({ ok: true });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err.message);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON.' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('LedgerLine running on port ' + PORT));