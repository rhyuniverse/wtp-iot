# PLC Monitor: RO & PSG

Dashboard for monitoring Reverse Osmosis (RO) and Pure Steam Generator (PSG) machines from PLC data.

## Run

Requires Node.js 22.9 or newer and Express 5:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Edit .env: set ADMIN_PASSWORD to a unique password of at least 12 characters.
npm install
npm start
```

On startup the server creates the database, tables and built-in roles if missing, and creates the first admin from `ADMIN_USERNAME` / `ADMIN_PASSWORD` when no users exist. After that, accounts and roles live in MySQL; changing `ADMIN_PASSWORD` in `.env` does not reset the password of an existing account.

MySQL (default `127.0.0.1:3306`, database `tesplc`; configure with `DB_*` in `.env`) stores the latest snapshots, samples, alarms, alarm rules, accounts and roles, and the activity log. Samples are kept for 90 days by default; change `HISTORY_RETENTION_DAYS` to adjust. Back up with `mysqldump tesplc`.

## PLC data ingest

- `POST /RO` or `POST /PSG`
- `POST /` with the machine identity in the body or headers
- `GET /data` returns the RO and PSG snapshots and requires a login with the `pid.view` permission

The ingest endpoints are unauthenticated, so keep the PLC network trusted. Serve the dashboard over HTTPS on a shared network; set `COOKIE_SECURE=true` to mark cookies Secure.

## Alarms and history

Sample history accumulates from the moment the server starts; earlier data cannot be recovered. Numeric alarm rules are created under **Access settings**; tags without a rule never raise value alarms. Limits are exclusive. Acknowledging an alarm does not delete it; alarms clear automatically once the value is back within limits.

The dashboard never sends control commands to the PLC. The P&ID is read-only.
