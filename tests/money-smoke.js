const pool = require('../db');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
let passed = 0;
let failed = 0;
let counter = 0;

function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

const newKey = () => 'key-' + Date.now() + '-' + (++counter) + '-' + Math.random().toString(36).slice(2, 8);

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

async function makeUser(label) {
  const email = label + Date.now() + '@example.com';
  const password = 'a-strong-password-123';
  const reg = await call('POST', '/api/auth/register', { email, password });
  const login = await call('POST', '/api/auth/login', { email, password });
  return { id: reg.data.id, token: login.data.token };
}

async function makeAccount(user, name) {
  const r = await call('POST', '/api/accounts', { name }, user.token);
  return String(r.data.id);
}

async function balanceOf(accountId, token) {
  const r = await call('GET', '/api/accounts/' + accountId, null, token);
  return Number(r.data.balance);
}

const deposit = (token, account_id, amount, key) =>
  call('POST', '/api/transactions/deposit', { account_id, amount }, token, key);
const withdraw = (token, account_id, amount, key) =>
  call('POST', '/api/transactions/withdraw', { account_id, amount }, token, key);
const transfer = (token, from_account_id, to_account_id, amount, key) =>
  call('POST', '/api/transactions/transfer', { from_account_id, to_account_id, amount }, token, key);

async function run() {
  const a = await makeUser('alice');
  const b = await makeUser('bob');
  const accA = await makeAccount(a, 'A main');
  const accB = await makeAccount(b, 'B main');
  const bank = String((await pool.query('SELECT id FROM accounts WHERE is_system')).rows[0].id);

  // Basic deposit and idempotency
  let r = await deposit(a.token, accA, 10000);
  check('1. Deposit without an Idempotency-Key is refused (400)', r.status === 400, 'status ' + r.status);

  const k1 = newKey();
  r = await deposit(a.token, accA, 10000, k1);
  const first = r.data;
  check('2. Deposit works (201)', r.status === 201 && first && first.transaction_id, 'status ' + r.status);
  check('3. Balance is 10000 after the deposit', (await balanceOf(accA, a.token)) === 10000);

  r = await deposit(a.token, accA, 10000, k1);
  check('4. Same key and same request replays the first result and moves no money',
    r.status === 201 && r.data && r.data.transaction_id === first.transaction_id &&
    (await balanceOf(accA, a.token)) === 10000, 'status ' + r.status);

  r = await deposit(a.token, accA, 99, k1);
  check('5. Same key with a different amount is refused (422)', r.status === 422, 'status ' + r.status);

  // Bad amounts
  const badAmounts = [0, -5, 1.5, '100', 'abc', null, 100000001, 1e21];
  let allBad = true;
  for (const amt of badAmounts) {
    const res = await deposit(a.token, accA, amt, newKey());
    if (res.status !== 400) { allBad = false; console.log('      amount ' + JSON.stringify(amt) + ' gave ' + res.status); }
  }
  check('6. Zero, negative, fractional, text, null and huge amounts are all refused (400)', allBad);

  // Insufficient funds
  r = await withdraw(a.token, accA, 50000, newKey());
  check('7. Withdrawing more than the balance is refused (422)', r.status === 422, 'status ' + r.status);
  check('8. The balance is unchanged after the failed withdrawal', (await balanceOf(accA, a.token)) === 10000);

  // Ownership
  const o1 = await deposit(b.token, accA, 100, newKey());
  const o2 = await withdraw(b.token, accA, 100, newKey());
  const o3 = await transfer(b.token, accA, accB, 100, newKey());
  check("9. Bob cannot deposit into, withdraw from or transfer out of Alice's account (404)",
    o1.status === 404 && o2.status === 404 && o3.status === 404, [o1.status, o2.status, o3.status].join(','));
  check("10. Alice's balance is unchanged after Bob's attempts", (await balanceOf(accA, a.token)) === 10000);

  // Transfers
  r = await transfer(a.token, accA, accB, 2500, newKey());
  check('11. Transfer works (201)', r.status === 201, 'status ' + r.status);
  check('12. Balances are 7500 and 2500 after the transfer',
    (await balanceOf(accA, a.token)) === 7500 && (await balanceOf(accB, b.token)) === 2500);

  r = await transfer(a.token, accA, accA, 100, newKey());
  check('13. Transfer to the same account is refused (400)', r.status === 400, 'status ' + r.status);
  r = await transfer(a.token, accA, bank, 100, newKey());
  check('14. Transfer to the bank cash account is refused (404)', r.status === 404, 'status ' + r.status);
  r = await transfer(a.token, accA, '99999999999', 100, newKey());
  check('15. Transfer to an account that does not exist is refused (404)', r.status === 404, 'status ' + r.status);
  r = await deposit(a.token, bank, 100, newKey());
  check('16. Deposit straight into the bank cash account is refused (404)', r.status === 404, 'status ' + r.status);

  // Concurrency: 20 withdrawals of 1000 from a balance of 7500 at the same moment
  const results = await Promise.all(
    Array.from({ length: 20 }, () => withdraw(a.token, accA, 1000, newKey()))
  );
  const ok = results.filter((x) => x.status === 201).length;
  const refused = results.filter((x) => x.status === 422).length;
  const finalBal = await balanceOf(accA, a.token);
  check('17. 20 simultaneous withdrawals: exactly 7 succeed and 13 are refused',
    ok === 7 && refused === 13, 'succeeded ' + ok + ', refused ' + refused);
  check('18. The balance after the race is exactly 500 and never negative', finalBal === 500, 'balance ' + finalBal);

  // Concurrency: the same request sent 10 times at once
  const dupKey = newKey();
  const dups = await Promise.all(Array.from({ length: 10 }, () => deposit(a.token, accA, 700, dupKey)));
  const ids = new Set(dups.map((x) => x.data && x.data.transaction_id));
  check('19. 10 simultaneous copies of one request create exactly one transaction',
    dups.every((x) => x.status === 201) && ids.size === 1, 'statuses ' + dups.map((x) => x.status).join(','));
  check('20. That request moved money only once (balance 1200)', (await balanceOf(accA, a.token)) === 1200);

  // Concurrency: opposite transfers at the same time (deadlock test)
  const before = (await balanceOf(accA, a.token)) + (await balanceOf(accB, b.token));
  const both = await Promise.all([
    ...Array.from({ length: 10 }, () => transfer(a.token, accA, accB, 10, newKey())),
    ...Array.from({ length: 10 }, () => transfer(b.token, accB, accA, 10, newKey())),
  ]);
  const serverErrors = both.filter((x) => x.status >= 500).length;
  const after = (await balanceOf(accA, a.token)) + (await balanceOf(accB, b.token));
  check('21. 20 opposite transfers at once cause no deadlock or server error',
    serverErrors === 0 && both.every((x) => x.status === 201), 'statuses ' + both.map((x) => x.status).join(','));
  check('22. Money is conserved across those transfers', before === after, before + ' vs ' + after);

  // Database-level invariants
  const ledgerSum = await pool.query('SELECT COALESCE(SUM(amount), 0)::text AS s FROM ledger_entries');
  check('23. All ledger entries together add up to exactly 0', ledgerSum.rows[0].s === '0', ledgerSum.rows[0].s);
  const balSum = await pool.query('SELECT COALESCE(SUM(balance), 0)::text AS s FROM accounts');
  check('24. All account balances (including the bank) add up to exactly 0', balSum.rows[0].s === '0', balSum.rows[0].s);
  const mismatch = await pool.query(
    `SELECT count(*)::int AS n FROM accounts a
      WHERE a.balance <> COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE account_id = a.id), 0)`
  );
  check('25. Every account balance matches the sum of its ledger entries', mismatch.rows[0].n === 0, 'mismatches ' + mismatch.rows[0].n);

  // Tampering attempts directly on the database
  let blocked = false;
  try { await pool.query('UPDATE ledger_entries SET amount = amount + 1 WHERE id = (SELECT min(id) FROM ledger_entries)'); }
  catch (e) { blocked = /append-only/.test(e.message); }
  check('26. Editing a ledger entry is refused by the database', blocked);

  blocked = false;
  try { await pool.query('DELETE FROM ledger_entries WHERE id = (SELECT min(id) FROM ledger_entries)'); }
  catch (e) { blocked = /append-only/.test(e.message); }
  check('27. Deleting a ledger entry is refused by the database', blocked);

  blocked = false;
  try { await pool.query('TRUNCATE ledger_entries'); }
  catch (e) { blocked = /append-only/.test(e.message); }
  check('28. Wiping the ledger with TRUNCATE is refused by the database', blocked);

  blocked = false;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const t = await c.query("INSERT INTO transactions (type, amount, created_by) VALUES ('deposit', 5, $1) RETURNING id", [a.id]);
    await c.query('INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES ($1, $2, 5)', [t.rows[0].id, accA]);
    await c.query('COMMIT');
  } catch (e) {
    blocked = /not balanced/.test(e.message);
    await c.query('ROLLBACK').catch(() => {});
  } finally {
    c.release();
  }
  check('29. A one-sided (unbalanced) transaction is refused by the database', blocked);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  await pool.end();
  process.exit(failed ? 1 : 0);
}

run().catch(async (err) => {
  console.error('Test run crashed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});