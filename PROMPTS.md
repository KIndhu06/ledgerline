# PROMPTS.md

I used Claude (Anthropic) to help build LedgerLine. This file lists the times
it gave me something wrong, and what I did about it. I ran each change on my
own computer and ran the tests after it.

## 1. 10 Nov: a database rule that PostgreSQL did not accept

**What I asked:** I asked Claude to build deposits, withdrawals and transfers, and to add a database check so that every transaction adds up to zero.

**What it gave me:** a trigger written as `CREATE OR REPLACE CONSTRAINT TRIGGER`.

**What was wrong:** PostgreSQL does not allow that. When I ran `npm start`, the migration stopped with the message "CREATE OR REPLACE CONSTRAINT TRIGGER is not supported".

**What I did:** I sent the error back to Claude and asked for the complete `schema.sql` again. The new file drops the trigger first and then uses `CREATE CONSTRAINT TRIGGER`. After that the migration worked, and test 29 in `money-smoke.js` passes.

**Commit:** f43c080

## 2. 10 Nov: the audit trail could be wiped with TRUNCATE

**What I asked:** I asked Claude to review and test the project like a senior engineer who deploys and maintains secure systems.

**What it gave me:** triggers that block UPDATE and DELETE on `transactions`, `ledger_entries` and `audit_log`.

**What was wrong:** Claude pointed out in its review that TRUNCATE was not blocked. Someone could empty a whole table with one command and skip those triggers. That would have destroyed the audit trail.

**What I did:** the TRUNCATE triggers are now in `schema.sql`. I added test 28 in `money-smoke.js`, which tries to wipe the ledger and checks that the database refuses.

**Commit:** f43c080

## 3. 11 Nov: a test pointing at a route that no longer existed

**What I asked:** I asked Claude to add read-only admin and auditor roles, with tests.

**What it gave me:** a test that checks a normal user is blocked from `/api/admin/ping`.

**What was wrong:** Claude had removed that temporary route, so when I ran `auth-smoke.js` against the live site, test 11 failed with status 404 instead of 403. The test was failing for the wrong reason.

**What I did:** I changed the test to use the real admin route `/api/admin/users`. Now it proves a normal user gets 403 from a real admin route.

**Commit:** ef90216

## 4. 11 Nov: the live site answered differently from my computer

**What I asked:** I asked Claude to help me test the live site.

**What it gave me:** an account test that expects status 400 for SQL-injection text in the URL.

**What was wrong:** on the live site, test 9 failed with status 403. I pasted the response, and the page said the request was blocked by Render's web application firewall. So my own code never saw it. The test had assumed the live site behaves exactly like my computer.

**What I did:** I changed test 9 to accept 400 (my code, which I checked locally) or 403 (the hosting firewall). In `THREATS.md` I wrote that the firewall is not something I built, so I do not claim it.

**Commit:** ef90216

## 5. 11 Nov: no admin or auditor accounts on the live site

**What I asked:** I asked Claude to help me deploy the project and test it.

**What it gave me:** a seed script (`seed.js`) that creates the admin and auditor accounts. I had only run it by hand on my computer.

**What was wrong:** when I pasted the Render log, Claude pointed out that the start command was `node migrate.js && node server.js`, with no seed step. So the live database would never have had its admin and auditor accounts.

**What I did:** I changed the start script in `package.json` to run `node seed.js` before the server. I added `SEED_ADMIN_PASSWORD` and `SEED_AUDITOR_PASSWORD` as environment variables on Render, and checked that the new log shows "Seeded admin" and "Seeded auditor".

**Commit:** c6ebfab