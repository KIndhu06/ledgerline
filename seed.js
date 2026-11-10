require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { logAudit } = require('./audit');

const STAFF = [
  { email: 'admin@ledgerline.local', role: 'admin', envName: 'SEED_ADMIN_PASSWORD' },
  { email: 'auditor@ledgerline.local', role: 'auditor', envName: 'SEED_AUDITOR_PASSWORD' },
];

async function seed() {
  const todo = STAFF.filter((s) => process.env[s.envName]);
  if (todo.length === 0) {
    console.log('Seed skipped: SEED_ADMIN_PASSWORD and SEED_AUDITOR_PASSWORD are not set');
    return;
  }

  for (const s of todo) {
    const password = process.env[s.envName];
    if (password.length < 12 || Buffer.byteLength(password) > 72) {
      throw new Error(s.envName + ' must be 12 to 72 characters long');
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
      [s.email, hash, s.role]
    );
    await logAudit(pool, null, 'staff_seeded', { email: s.email, role: s.role });
    console.log('Seeded ' + s.role + ': ' + s.email);
  }
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });