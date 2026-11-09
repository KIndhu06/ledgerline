require('dotenv').config();
const express = require('express');
const pool = require('./db');

const app = express();
app.use(express.json());

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ status: 'error', database: 'unreachable' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('LedgerLine running on port ' + PORT));