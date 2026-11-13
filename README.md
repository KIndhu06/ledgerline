# LedgerLine

A small banking system where money moves safely. Deposits, withdrawals and
transfers are recorded in a double-entry ledger. The same request never pays
twice, simultaneous withdrawals cannot overdraw an account, and the wrong
person cannot move money that is not theirs.

Live site: https://ledgerline-4lky.onrender.com
Health check: https://ledgerline-4lky.onrender.com/api/health

The live site runs on a free Render plan. After 15 minutes without traffic it
goes to sleep, so the first request can take about a minute. The free
database also expires 30 days after it was created.

## What works

- A web page at the live address: sign in or create an account, see your
  accounts and balances, deposit, withdraw, transfer, and read statements.
  Admin and auditor get read-only views (all accounts, reconcile check,
  audit log, and for admin a user list).
- Register and log in (passwords hashed with bcrypt, login tokens expire after 1 hour)
- Three roles: `holder`, `auditor`, `admin`, enforced on the server
- Holders create accounts (up to 5) and can only see and use their own
- Deposit, withdraw and transfer, in whole paise (1 rupee = 100 paise)
- Double-entry ledger: every transaction's entries add up to exactly zero
- No negative balances (checked in the code and by a database rule)
- Idempotency: a repeated request with the same `Idempotency-Key` pays once
- Locking, so simultaneous requests take turns and cannot overdraw
- Append-only audit trail and ledger (the database refuses UPDATE, DELETE and TRUNCATE)
- Admin and auditor are read-only: reconcile check, audit log, user list
- Automated API tests (listed below)

See `THREATS.md` for the threats I defend against, the tests that prove each
one, and what is NOT covered. See `PROMPTS.md` for where the AI was wrong.

## Not finished

- No demo video.
- The web page keeps the login token in memory only, so refreshing the page
  signs you out. I tested the page by hand. There are no automated browser tests.
- No refresh tokens or logout on the server side, no password reset, no email verification.
- Rate limits are kept in server memory and reset when the server restarts.
- The 5-account limit can be slightly exceeded by many simultaneous requests.

## Using the web page

Open the live address. Choose "Create account" to make a holder account, then
create an account, deposit, withdraw or transfer. For a transfer, enter the
other account's number. Amounts are in rupees (up to 2 decimals, maximum
10,00,000 per request).

Admin and auditor accounts cannot be created on the page. They are created by
the seed script (see "Staff accounts").

## API

All bodies are JSON. Amounts are whole numbers of paise.

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/health` | anyone | Checks the server and database |
| `POST /api/auth/register` | anyone | `{email, password}` (10 to 72 characters). Always creates a `holder` |
| `POST /api/auth/login` | anyone | Returns a token |
| `GET /api/me` | logged in | Your id, email and role |
| `POST /api/accounts` | holder | `{name}` creates an account |
| `GET /api/accounts` | logged in | Holder: own accounts. Admin and auditor: all |
| `GET /api/accounts/:id` | owner, admin, auditor | One account |
| `GET /api/accounts/:id/entries` | owner, admin, auditor | Statement (latest 100 ledger entries) |
| `POST /api/transactions/deposit` | holder | `{account_id, amount}` |
| `POST /api/transactions/withdraw` | holder | `{account_id, amount}` |
| `POST /api/transactions/transfer` | holder | `{from_account_id, to_account_id, amount}` |
| `GET /api/admin/reconcile` | admin, auditor | Recomputes every balance from the ledger |
| `GET /api/admin/audit?limit=50` | admin, auditor | Latest audit log rows |
| `GET /api/admin/users` | admin | List users (never shows password hashes) |

Send the token as `Authorization: Bearer <token>`. The three money routes
also need an `Idempotency-Key` header of 8 to 64 letters, numbers, `-` or `_`.

Errors: 400 bad input, 401 not logged in, 403 wrong role, 404 not found (also
used for other people's accounts), 409 conflict, 422 refused (for example
insufficient funds or a reused idempotency key), 429 too many attempts.

### Try it (curl)

```
curl -X POST https://ledgerline-4lky.onrender.com/api/auth/register -H "Content-Type: application/json" -d "{\"email\":\"you@example.com\",\"password\":\"a-long-password-123\"}"
curl -X POST https://ledgerline-4lky.onrender.com/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"you@example.com\",\"password\":\"a-long-password-123\"}"
```

Then, with the token from login and the id of an account you created:

```
curl -X POST https://ledgerline-4lky.onrender.com/api/transactions/deposit -H "Content-Type: application/json" -H "Authorization: Bearer YOUR_TOKEN" -H "Idempotency-Key: demo-key-0001" -d "{\"account_id\":1,\"amount\":10000}"
```

Sending the same command again returns the same result and moves no money.

## Staff accounts

Admin and auditor accounts cannot be created through the API or the web page.
They are created by `seed.js` when the server starts, using these emails:

- `admin@ledgerline.local`
- `auditor@ledgerline.local`

Their passwords come from the `SEED_ADMIN_PASSWORD` and `SEED_AUDITOR_PASSWORD`
environment variables.

## Run it on your own machine

Needs Node.js 22 or newer and PostgreSQL (tested with Node 22 and PostgreSQL 18).

1. Clone and install:

```
git clone https://github.com/KIndhu06/ledgerline.git
cd ledgerline
npm install
```

2. Create the database. In `psql` as the postgres user:

```
CREATE USER ledgerline_app WITH PASSWORD 'choose_a_password';
CREATE DATABASE ledgerline_db OWNER ledgerline_app;
```

3. Copy `.env.example` to `.env` and fill it in:

```
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ledgerline_db
DB_USER=ledgerline_app
DB_PASSWORD=the_password_from_step_2
JWT_SECRET=a_random_string_of_at_least_32_characters
SEED_ADMIN_PASSWORD=at_least_12_characters
SEED_AUDITOR_PASSWORD=at_least_12_characters
```

You can make a secret with:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

To use one connection string instead (this is how Render does it), set
`DATABASE_URL` and the `DB_*` values are ignored. Set `DB_SSL=true` if your
database needs SSL.

4. Start it:

```
npm start
```

This creates the tables, creates the admin and auditor accounts, and starts
the server. Open http://localhost:3000 for the web page. You should see
`Database schema is ready` and `LedgerLine running on port 3000` in the terminal.

## Tests

Start the server in one terminal, then run the tests in a second terminal:

```
node tests/auth-smoke.js
node tests/accounts-smoke.js
node tests/money-smoke.js
node tests/admin-smoke.js
```

Expected: all lines say `PASS` (15, 13, 29 and 20 tests).

Notes:
- Login and register allow 20 attempts per 15 minutes. If you run several test
  files in a row and see "Too many attempts", restart the server (Ctrl + C,
  then `npm start`) and run the next file.
- `money-smoke.js` reads the database directly, so run it against a local
  server. `admin-smoke.js` needs `SEED_ADMIN_PASSWORD` and
  `SEED_AUDITOR_PASSWORD` in `.env`.
- To test the live site, set `BASE_URL` first (PowerShell:
  `$env:BASE_URL="https://ledgerline-4lky.onrender.com"`). On the live site,
  accounts-smoke test 9 may be blocked by the host's firewall with a 403,
  which the test accepts.

## Deploying on Render

1. Create a free Postgres database and a free Node web service from this repository.
2. Build command: `npm install`. Start command: `npm start`.
3. Set these environment variables on the web service: `DATABASE_URL` (the
   Internal Database URL), `JWT_SECRET`, `SEED_ADMIN_PASSWORD`,
   `SEED_AUDITOR_PASSWORD`.