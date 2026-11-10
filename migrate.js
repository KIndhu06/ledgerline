const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Database schema is ready');
}

migrate()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });