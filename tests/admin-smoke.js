require('dotenv').config();
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

async function call(method, path, body, token, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (key) headers['Idempotency-Key'] = key;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, data, text };
}

async function login(email, password) {
  const r = await call('POST', '/api/auth/login', { email, password });
  return r.data && r.data.token;
}

async function run() {
  if (!process.env.SEED_ADMIN_PASSWORD || !process.env.SEED_AUDITOR_PASSWORD) {
    console.log('Set SEED_ADMIN_PASSWORD and SEED_AUDITOR_PASSWORD in .env first.');
    process.exit(1);
  }

  const adminToken = await login('admin@ledgerline.local', process.env.SEED_ADMIN_PASSWORD);
  const auditorToken = await login('auditor@ledgerline.local', process.env.SEED_AUDITOR_PASSWORD);
  check('1. Admin can log in', !!adminToken);
  check('2. Auditor can log in', !!auditorToken);

  const email = 'holder' + Date.now() + '@example.com';
  await call('POST', '/api/auth/register', { email, password: 'a-strong-password-123' });
  const holderToken = await login(email, 'a-strong-password-123');
  const acc = await call('POST', '/api/accounts', { name: 'Holder main' }, holderToken);
  const accId = acc.data && acc.data.id;

  // Who may reach the admin routes
  let r = await call('GET', '/api/admin/reconcile');
  check('3. Reconcile without a token is refused (401)', r.status === 401, 'status ' + r.status);
  r = await call('GET', '/api/admin/reconcile', null, holderToken);
  check('4. Holder is blocked from reconcile (403)', r.status === 403, 'status ' + r.status);
  r = await call('GET', '/api/admin/audit', null, holderToken);
  check('5. Holder is blocked from the audit log (403)', r.status === 403, 'status ' + r.status);
  r = await call('GET', '/api/admin/users', null, holderToken);
  check('6. Holder is blocked from the user list (403)', r.status === 403, 'status ' + r.status);

  r = await call('GET', '/api/admin/reconcile', null, adminToken);
  check('7. Admin reconcile reports the books balance', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
  r = await call('GET', '/api/admin/reconcile', null, auditorToken);
  check('8. Auditor reconcile works too', r.status === 200 && r.data.ok === true, 'status ' + r.status);

  r = await call('GET', '/api/admin/audit?limit=5', null, auditorToken);
  check('9. Auditor can read the audit log', r.status === 200 && Array.isArray(r.data) && r.data.length > 0, 'status ' + r.status);
  check('10. The audit log shows no password hashes', r.text && !r.text.includes('$2'));

  r = await call('GET', '/api/admin/users', null, auditorToken);
  check('11. Auditor is blocked from the user list (403)', r.status === 403, 'status ' + r.status);
  r = await call('GET', '/api/admin/users', null, adminToken);
  check('12. Admin can list users', r.status === 200 && Array.isArray(r.data), 'status ' + r.status);
  check('13. The user list never contains password hashes', r.text && !r.text.includes('password') && !r.text.includes('$2'));

  // Read-only: staff cannot move money or open accounts
  const key = () => 'key-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  const dep = { account_id: accId, amount: 100 };
  r = await call('POST', '/api/transactions/deposit', dep, adminToken, key());
  check('14. Admin cannot deposit (403)', r.status === 403, 'status ' + r.status);
  r = await call('POST', '/api/transactions/deposit', dep, auditorToken, key());
  check('15. Auditor cannot deposit (403)', r.status === 403, 'status ' + r.status);
  r = await call('POST', '/api/accounts', { name: 'Admin account' }, adminToken);
  check('16. Admin cannot create an account (403)', r.status === 403, 'status ' + r.status);

  // Staff can look, holders cannot see other people's accounts
  r = await call('GET', '/api/accounts/' + accId, null, auditorToken);
  check("17. Auditor can read a holder's account", r.status === 200, 'status ' + r.status);
  r = await call('GET', '/api/accounts/' + accId + '/entries', null, adminToken);
  check("18. Admin can read a holder's statement", r.status === 200, 'status ' + r.status);

  // Cleanup check
  r = await call('GET', '/api/admin/ping', null, adminToken);
  check('19. The old temporary test route is gone (404)', r.status === 404, 'status ' + r.status);

  // Staff cannot be created through the public API
  r = await call('POST', '/api/auth/register', { email: 'sneaky' + Date.now() + '@example.com', password: 'a-strong-password-123', role: 'auditor' });
  check('20. Registering with role "auditor" still gives holder', r.status === 201 && r.data.role === 'holder', JSON.stringify(r.data));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

run().catch((err) => { console.error('Test run crashed:', err.message); process.exit(1); });