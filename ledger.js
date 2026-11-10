const crypto = require('crypto');
const pool = require('./db');
const { logAudit } = require('./audit');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hashRequest(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

async function moveMoney({ user, type, fromId, toId, amount, key }) {
  const requestHash = hashRequest([type, fromId, toId, amount]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Claim the idempotency key. A simultaneous request with the same key waits here.
    const claim = await client.query(
      `INSERT INTO idempotency_keys (user_id, key, request_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, key) DO NOTHING
       RETURNING key`,
      [user.id, key, requestHash]
    );

    if (claim.rowCount === 0) {
      const prev = await client.query(
        'SELECT request_hash, status_code, response FROM idempotency_keys WHERE user_id = $1 AND key = $2',
        [user.id, key]
      );
      await client.query('ROLLBACK');
      const row = prev.rows[0];
      if (row.request_hash !== requestHash) {
        throw new HttpError(422, 'This Idempotency-Key was already used for a different request.');
      }
      return { status: row.status_code, body: row.response, replayed: true };
    }

    // 2. Work out which account is debited and which is credited.
    const bank = String((await client.query('SELECT id FROM accounts WHERE is_system')).rows[0].id);
    let debitId;
    let creditId;
    if (type === 'deposit') { debitId = bank; creditId = toId; }
    else if (type === 'withdrawal') { debitId = fromId; creditId = bank; }
    else { debitId = fromId; creditId = toId; }

    // 3. Lock both accounts, always in order of id (prevents deadlocks).
    const ids = Array.from(new Set([debitId, creditId]))
      .sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
    const locked = await client.query(
      `SELECT id, owner_id, balance, is_system
         FROM accounts
        WHERE id = ANY($1::bigint[])
        ORDER BY id
          FOR UPDATE`,
      [ids]
    );
    const byId = new Map(locked.rows.map((row) => [String(row.id), row]));

    // 4. Authorisation: you may only touch your own accounts.
    const mine = (acc) => acc && !acc.is_system && String(acc.owner_id) === String(user.id);
    if (type === 'deposit' && !mine(byId.get(creditId))) {
      throw new HttpError(404, 'Account not found.');
    }
    if (type !== 'deposit' && !mine(byId.get(debitId))) {
      throw new HttpError(404, 'Account not found.');
    }
    if (type === 'transfer') {
      const dest = byId.get(creditId);
      if (!dest || dest.is_system) throw new HttpError(404, 'Destination account not found.');
    }

    // 5. The balance must cover it.
    if (type !== 'deposit' && BigInt(byId.get(debitId).balance) < BigInt(amount)) {
      throw new HttpError(422, 'Insufficient funds.');
    }

    // 6. Record the transaction and its two ledger entries (they add up to zero).
    const tx = await client.query(
      'INSERT INTO transactions (type, amount, created_by) VALUES ($1, $2, $3) RETURNING id, created_at',
      [type, amount, user.id]
    );
    const txId = tx.rows[0].id;
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, amount)
       VALUES ($1, $2, $3), ($1, $4, $5)`,
      [txId, debitId, -amount, creditId, amount]
    );

    // 7. Update the balances.
    await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amount, debitId]);
    await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amount, creditId]);

    // 8. Audit trail and idempotent response.
    await logAudit(client, user.id, type, {
      transaction_id: txId,
      from_account_id: fromId,
      to_account_id: toId,
      amount,
      idempotency_key: key,
    });

    const body = {
      transaction_id: txId,
      type,
      amount,
      from_account_id: fromId,
      to_account_id: toId,
      created_at: tx.rows[0].created_at,
    };
    await client.query(
      'UPDATE idempotency_keys SET status_code = $3, response = $4 WHERE user_id = $1 AND key = $2',
      [user.id, key, 201, JSON.stringify(body)]
    );

    await client.query('COMMIT');
    return { status: 201, body, replayed: false };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { moveMoney, HttpError };