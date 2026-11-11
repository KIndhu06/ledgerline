const BASE = process.env.BASE_URL || 'http://localhost:3000';
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log('PASS  ' + name);
  } else {
    failed++;
    console.log('FAIL  ' + name + (detail ? '  -> ' + detail : ''));
  }
}

async function call(method, path, body, token, rawBody) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, data, text };
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

async function run() {
  const email = 'test' + Date.now() + '@example.com';
  const password = 'a-strong-password-123';

  // 1. Normal registration works and gives the holder role
  let r = await call('POST', '/api/auth/register', { email, password });
  check('1. Register works and role is holder', r.status === 201 && r.data && r.data.role === 'holder', 'status ' + r.status);
  check('2. Response does not leak the password hash', r.text && !r.text.includes('password_hash') && !r.text.includes('$2'));

  // 3. Trying to pick admin role is ignored
  const email2 = 'test2' + Date.now() + '@example.com';
  r = await call('POST', '/api/auth/register', { email: email2, password, role: 'admin' });
  check('3. Cannot register as admin (role field ignored)', r.status === 201 && r.data && r.data.role === 'holder', JSON.stringify(r.data));

  // 4. Duplicate email
  r = await call('POST', '/api/auth/register', { email, password });
  check('4. Duplicate email is refused (409)', r.status === 409, 'status ' + r.status);

  // 5. Weak password
  r = await call('POST', '/api/auth/register', { email: 'x' + Date.now() + '@example.com', password: 'short' });
  check('5. Short password is refused (400)', r.status === 400, 'status ' + r.status);

  // 6 and 7. Login failures look identical
  const wrongPw = await call('POST', '/api/auth/login', { email, password: 'wrong-password-123' });
  const noUser = await call('POST', '/api/auth/login', { email: 'nobody' + Date.now() + '@example.com', password });
  check('6. Wrong password gives 401', wrongPw.status === 401, 'status ' + wrongPw.status);
  check('7. Unknown email gives the same 401 and message',
    noUser.status === 401 && wrongPw.data && noUser.data && wrongPw.data.error === noUser.data.error);

  // 8. Good login
  r = await call('POST', '/api/auth/login', { email, password });
  const token = r.data && r.data.token;
  check('8. Login works and returns a token', r.status === 200 && typeof token === 'string', 'status ' + r.status);

  // 9. No token
  r = await call('GET', '/api/me');
  check('9. /api/me without a token is refused (401)', r.status === 401, 'status ' + r.status);

  // 10. Valid token
  r = await call('GET', '/api/me', null, token);
  check('10. /api/me with a valid token works', r.status === 200 && r.data && r.data.email === email, 'status ' + r.status);

  // 11. Holder cannot use an admin route
  r = await call('GET', '/api/admin/users', null, token);
  check('11. Holder is blocked from admin route (403)', r.status === 403, 'status ' + r.status);

  // 12. Tampered token
  const parts = (token || 'a.b.c').split('.');
  const flipped = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'A' ? 'B' : 'A');
  r = await call('GET', '/api/me', null, parts[0] + '.' + parts[1] + '.' + flipped);
  check('12. Tampered token is refused (401)', r.status === 401, 'status ' + r.status);

  // 13. Token with alg "none"
  const fake = b64url({ alg: 'none', typ: 'JWT' }) + '.' + b64url({ sub: '1' }) + '.';
  r = await call('GET', '/api/me', null, fake);
  check('13. Unsigned "alg none" token is refused (401)', r.status === 401, 'status ' + r.status);

  // 14. Broken JSON and SQL-injection text
  r = await call('POST', '/api/auth/login', null, null, '{bad json');
  check('14a. Broken JSON gives a clean 400 with no stack trace',
    r.status === 400 && !/at\s.+\.js|node_modules|SyntaxError/i.test(r.text), 'status ' + r.status);
  r = await call('POST', '/api/auth/login', { email: "' OR '1'='1", password: "' OR '1'='1" });
  check('14b. SQL-injection text is refused (400)', r.status === 400, 'status ' + r.status);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run crashed:', err.message);
  process.exit(1);
});