# LedgerLine threat model

This lists the ways someone could abuse LedgerLine, what stops them, and which
test proves it. It also lists what is NOT covered. Money is stored as whole
numbers of paise, never decimals.

Tests live in `tests/`. Run them with the server running (see README).

## Threats I defend against

| # | Threat | Defence | Proof |
|---|--------|---------|-------|
| 1 | Same request sent twice, so money moves twice | Every money request needs an `Idempotency-Key`. The key and a hash of the request are stored with a unique constraint on (user, key). Same key and same request replays the first result. Same key with a different request is refused (422). | money-smoke 4, 5, 19, 20 |
| 2 | Many withdrawals at the same moment overdraw an account | One database transaction per request. The accounts are locked with `SELECT ... FOR UPDATE` before the balance is checked. A `CHECK (balance >= 0)` constraint is a second line of defence. | money-smoke 17, 18 |
| 3 | Two opposite transfers deadlock each other | Accounts are always locked in order of id. | money-smoke 21, 22 |
| 4 | Withdrawing more than the balance | Server-side check returns 422, and the database refuses a negative balance even if the code is wrong. | money-smoke 7, 8 |
| 5 | A user moves money from someone else's account | The owner comes from the login token, never from the request. Someone else's account returns 404, so account numbers cannot be guessed. | money-smoke 9, 10; accounts-smoke 5, 6 |
| 6 | A user makes themselves admin or auditor | Registration always gives the `holder` role and ignores any `role` field. Admin and auditor accounts only come from a seed script using passwords from environment variables. | auth-smoke 3; admin-smoke 20 |
| 7 | Role checks done only in the browser | Every route checks the role on the server. The role is loaded from the database on every request, not trusted from the token. | auth-smoke 11; admin-smoke 3 to 6 |
| 8 | Admin or auditor account used to steal money | Both roles are read-only. They cannot deposit, withdraw, transfer or create accounts. | admin-smoke 14, 15, 16 |
| 9 | Forged, edited or unsigned login tokens | Tokens are signed (HS256) and only that algorithm is accepted. The server will not start if the signing secret is missing or shorter than 32 characters. | auth-smoke 12, 13 |
| 10 | Changing or deleting ledger history | Triggers block UPDATE, DELETE and TRUNCATE on `transactions`, `ledger_entries` and `audit_log`. | money-smoke 26, 27, 28 |
| 11 | A one-sided transaction that creates or destroys money | A deferred database trigger refuses any transaction whose ledger entries do not add up to exactly zero. | money-smoke 29 |
| 12 | Balances drifting away from the ledger | `/api/admin/reconcile` recomputes every balance from the ledger and reports mismatches. Tests check that the ledger total is 0 and each balance matches its entries. | money-smoke 23, 24, 25; admin-smoke 7, 8 |
| 13 | Bad amounts (0, negative, decimals, text, huge) | Amounts must be whole numbers of paise between 1 and 100,000,000. | money-smoke 6 |
| 14 | SQL injection | Every query uses `$1` placeholders. Ids in URLs must match a strict number pattern. | accounts-smoke 8, 9 |
| 15 | Password guessing and account probing | bcrypt password hashing. Login and register are rate limited. Wrong password and unknown email give the same error. Failed logins go to the audit log. | auth-smoke 6, 7 |
| 16 | Secrets leaking | `.env` is in `.gitignore`. Error responses are generic and never show stack traces. Password hashes are never returned. | auth-smoke 2, 14a; admin-smoke 10, 13 |
| 17 | Nobody can tell who moved money | Every transaction stores who created it. Every money movement, registration, login and failed login writes to the append-only audit log. | admin-smoke 9 |

## Not covered, or only partly covered

- The app's database user owns the tables, so someone who got full control of
  that user could remove the triggers. Free hosting gives one database user.
  With a paid database I would use a separate, limited user for the app.
- There is no refresh-token or logout system. Tokens simply expire after one hour.
- The limit of 5 accounts per user could be slightly exceeded by many
  simultaneous requests.
- Rate limits are kept in server memory, so they reset on restart and are per
  server instance.
- The money tests that read the database directly (money-smoke 23 to 29) only
  run against a local database, not the live one.
- The live site sits behind the hosting provider's firewall, which blocks some
  attack text (for example SQL-injection-looking URLs) with a 403 before it
  reaches my code. I did not build that layer. My own code rejects the same
  input with a 400 (accounts-smoke 9 locally).
- No email verification, password reset or two-factor login.
- I have not done a professional penetration test or load test.