const BASE = process.env.BASE_URL || 'http://localhost:3000';
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, data, text };
}

async function makeUser(label) {
  const email = label + Date.now() + '@example.com';
  const password = 'a-strong-password-123';
  const reg = await call('POST', '/api/auth/register', { email, password });
  const login = await call('POST', '/api/auth/login', { email, password });
  return { id: reg.data.id, token: login.data.token };
}

async function run() {
  const a = await makeUser('alice');
  const b = await makeUser('bob');

  let r = await call('POST', '/api/accounts', { name: 'Alice savings', owner_id: b.id, balance: 1000000 }, a.token);
  const acc = r.data;
  check('1. Holder can create an account', r.status === 201 && acc && acc.id, 'status ' + r.status);
  check('2. Balance starts at 0 even if the client sends one', acc && String(acc.balance) === '0', JSON.stringify(acc));

  r = await call('GET', '/api/accounts/' + acc.id, null, a.token);
  check('3. Owner can read the account', r.status === 200 && r.data.name === 'Alice savings', 'status ' + r.status);
  check('4. The owner is the logged-in user, not the id sent in the body',
    (await call('GET', '/api/accounts', null, b.token)).data.length === 0);

  r = await call('GET', '/api/accounts/' + acc.id, null, b.token);
  check("5. Another user cannot read Alice's account (404)", r.status === 404, 'status ' + r.status);
  r = await call('GET', '/api/accounts/' + acc.id + '/entries', null, b.token);
  check("6. Another user cannot read Alice's statement (404)", r.status === 404, 'status ' + r.status);

  r = await call('GET', '/api/accounts/' + acc.id);
  check('7. No token is refused (401)', r.status === 401, 'status ' + r.status);
  r = await call('GET', '/api/accounts/abc', null, a.token);
  check('8. Non-numeric id is refused (400)', r.status === 400, 'status ' + r.status);
  r = await call('GET', '/api/accounts/1%20OR%201=1', null, a.token);
  check('9. SQL-injection text in the id is refused (400)', r.status === 400, 'status ' + r.status);
  r = await call('GET', '/api/accounts/99999999999', null, a.token);
  check('10. Account that does not exist gives 404', r.status === 404, 'status ' + r.status);

  r = await call('POST', '/api/accounts', { name: '' }, a.token);
  check('11. Empty account name is refused (400)', r.status === 400, 'status ' + r.status);
  r = await call('POST', '/api/accounts', { name: 'x'.repeat(61) }, a.token);
  check('12. Overlong account name is refused (400)', r.status === 400, 'status ' + r.status);

  for (let i = 2; i <= 5; i++) await call('POST', '/api/accounts', { name: 'Account ' + i }, a.token);
  r = await call('POST', '/api/accounts', { name: 'One too many' }, a.token);
  check('13. Sixth account is refused (409)', r.status === 409, 'status ' + r.status);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

run().catch((err) => { console.error('Test run crashed:', err.message); process.exit(1); });