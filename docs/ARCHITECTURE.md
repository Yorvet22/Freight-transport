# Architecture notes

Complements [`SPEC.md`](SPEC.md) (the binding contract). This file explains *how* the backend is built and records
decisions the spec leaves open. MySQL 8 is the only storage (SPEC §11); there is no in-memory engine.

## Composition

```
server.js ──> createPool(db config) ──> checkDatabase (ping + no pending migrations)
          └─> createApp({ pool, authDisabled, sessionSecret, corsOrigin, logger })      src/app.js
                 ├─ createRepositories(pool)        order / vehicle / warehouse / history repos (SQL)
                 ├─ createPlatform({ pool, repos, authDisabled, sessionSecret, logger })  src/platform.js
                 └─ domain services (orders, vehicles, warehouses) receive repos + platform.audit
```

`createPlatform` returns:

| Member | Purpose |
|---|---|
| `mount(app)` | Registers `/api/auth`, `/api/users`, `/api/audit`, `/api/dashboard`, `/api/reports` (each applies its own guards) |
| `authenticate` | Middleware; the app mounts it on `/api` before the domain routers |
| `requireRole(minRole)` | Middleware factory used by domain routers for write endpoints |
| `audit` | `AuditService`: `audit.record({ user, action, entity, entityId, details }, conn?)` → Promise |
| `userRepo` | The MySQL user repository (used by tests and tooling) |

Optional injections (mainly for tests): `repos.userRepo`, `repos.auditRepo`, `rateLimiter`, `env`.

Order inside the app: helmet → CORS (only if `CORS_ORIGIN`) → JSON body → `/api/health` → `platform.mount(app)` →
`app.use('/api', platform.authenticate)` → domain routers → `/api` 404 → static frontend → error handler.
`POST /api/auth/login` is the only public platform endpoint.

The pool is owned by the caller (`server.js` or a test); `server.js` closes the HTTP server and then the pool on
SIGINT/SIGTERM.

## Database

- Schema = versioned migrations in `database/migrations/NNN_name.sql`, applied by `src/db/migrate.js` and tracked in
  `schema_migrations`. `npm run db:setup` creates the database, migrates and seeds demo data when empty.
- Pool (`src/db/pool.js`): `timezone: 'Z'` (all `DATETIME` values are UTC), `DATE` columns as `'YYYY-MM-DD'` strings,
  `DECIMAL` as numbers, positional `?` placeholders only. Identifiers in SQL come from whitelists, never from input.
- Multi-row changes (order creation, status changes) run in one transaction (`withTransaction`).

## Authentication

- **Passwords**: `scrypt$<saltHex>$<hashHex>`, 16-byte random salt, 64-byte key (`crypto.scryptSync`),
  compared with `crypto.timingSafeEqual` (`src/auth/password.js`, also used by the seed).
- **Token**: `base64url(JSON {uid, username, role, exp}) + "." + base64url(HMAC-SHA256(secret, payloadPart))`,
  valid for 8 hours. Signature checked in constant time, then expiry. No server-side session store.
- **Cookie**: `ft_token`, `HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`, parsed by a tiny built-in parser
  (`src/auth/cookies.js`).
- **`authenticate`** loads the user via `userRepo.findById(uid)` on every request and builds `req.user` from the stored
  record, so deleting a user or changing a role takes effect immediately (missing user → `401`).
- **Login** returns the same `401 UNAUTHORIZED` "Invalid username or password." for an unknown user and a wrong
  password; an unknown user still costs one scrypt computation (no timing oracle). Missing/non-string fields → `400`.
- **Login rate limiting** (`src/auth/rateLimiter.js`): in-process `Map` keyed by `IP + lower-cased username`.
  Each failed login increments the counter; the 15-minute window starts at the first failure. With 10 failures in the
  window every further attempt (even with the right password) gets `429 TOO_MANY_REQUESTS` until the window expires.
  A successful login resets the key; expired entries are swept lazily. State is per process (fine for a single
  instance; a multi-instance deployment would need a shared store). `req.ip` is used, so behind a reverse proxy
  Express `trust proxy` must be configured.
- **Roles**: rank `viewer (1) < dispatcher (2) < admin (3)`. `requireRole(min)` → `401` without a user, `403 FORBIDDEN`
  if the rank is too low.
- **Secret**: `SESSION_SECRET`. Missing with `NODE_ENV=production` → `createPlatform` throws (server.js also refuses to
  start). Otherwise a random secret is generated and a warning logged (sessions end on restart).
- **`authDisabled`** (`AUTH_DISABLED=true`, refused in production): every request runs as
  `{ id: 0, username: 'system', role: 'admin' }`.

## Users

- Validation: `username` trimmed, 1–50 chars, letters/digits/`.`/`_`/`-`; `password` 6–200 chars; `role` one of the enum.
- Usernames are unique case-insensitively (`utf8mb4_unicode_ci` unique key) → `409 DUPLICATE_USERNAME`.
- Responses never include `passwordHash`. An admin cannot delete their own account (`400 VALIDATION_ERROR`).
- User create/delete are written to the audit log (`details: { username, role }`, never the password or hash).

## Audit log

- Table `audit_log(id, userId NULL, username, action, entity, entityId, details JSON NULL, createdAt)`, no foreign keys
  so entries outlive deleted users and entities. Index on `(entity, entityId)` and `createdAt`.
- `platform.audit.record({ user, action, entity, entityId, details }, conn?)`:
  `action ∈ create | update | delete | status_change`, `entity ∈ order | vehicle | warehouse | user`, `entityId` a positive
  integer (anything else is a programming error and throws). `userId` is `req.user.id`, or `NULL` for the system user
  (`id 0`, auth disabled) or when no user is given; `username` defaults to `system`. Passing a transaction connection
  makes the entry commit/roll back together with the change.
- Writers: the platform records user create/delete; the domain services record orders, vehicles and warehouses through a
  wrapper (`src/domain/audit.js`) that logs and swallows audit failures, so an audit problem never fails a request.
  `UserService` applies the same policy.
- `GET /api/audit?entity=&entityId=&page=&limit=` (admin): newest first (`createdAt DESC, id DESC`), `limit` default 20,
  max 500; invalid params → `400 INVALID_QUERY`. Returns `{ items, total, page, limit }`; `details` is parsed JSON.

## Analytics (dashboard and reports)

Aggregates are computed **in SQL** (`src/repositories/dashboardRepository.js`, `reportRepository.js`) with `COUNT`,
conditional `SUM(status = '…')`, `GROUP BY` and `DATE()`/`DATE_FORMAT()` on UTC `DATETIME`s. The services only compose the
payload: zero-fill days, compute ratios, round. `recentOrders` and the report `orders` reuse the order list query
(`orderRepo.list` / `orderRepo.listAll`), so they have the normal list shape (joined names, no `podSignature`).

### `GET /api/dashboard/kpis`

| Field | Definition |
|---|---|
| `orders`, `vehicles` | Counts per status plus `total` |
| `onTimeRate` | delivered orders with `DATE(deliveredAt) <= plannedDeliveryDate` ÷ delivered orders that have a planned date; `null` if none |
| `fleetUtilization` | `on_trip ÷ (total − maintenance)`; `null` if the denominator is 0 |
| `avgTransitHours` | mean of `deliveredAt − latest "→ in_transit" history changedAt` over delivered orders that have such a row (and `deliveredAt` not earlier); 2 decimals; `null` if none |
| `ordersPerDay` | 14 UTC days, oldest first, ending today (UTC), zero-filled, by `createdAt` |
| `warehouses` | every warehouse ordered by `code`: `inbound` = orders with it as destination, `outbound` = as origin (all statuses) |
| `recentOrders` | 5 newest by `createdAt` (ties: higher id first) |

Rates are fractions 0..1 rounded to 4 decimals.

### `GET /api/reports/summary`

- Query: `from`, `to` — inclusive `YYYY-MM-DD` UTC days on `createdAt` (implemented as `createdAt >= from 00:00` and
  `< to + 1 day`); `warehouseId` — origin **or** destination; `vehicleId`. Empty strings mean "no filter". Malformed
  dates/ids or `from > to` → `400 INVALID_QUERY` with `details`.
- `filters` echoes the parsed values (`null` when absent, ids as numbers).
- `totals`: counts per status over the filtered orders; `totalWeight` = sum of `cargoWeight` (2 decimals, all statuses);
  `deliveryRate = delivered ÷ orders` (0 when there are no orders).
- `byWarehouse`: every warehouse ordered by `code` (only the selected one when `warehouseId` is given; none if it does not
  exist): `inbound`/`outbound` counts and `weight` of the filtered orders touching it (`LEFT JOIN` with the filters in `ON`).
- `byVehicle`: every vehicle ordered by `licensePlate` (only the selected one when `vehicleId` is given): `trips` =
  filtered orders assigned to it with status `in_transit` or `delivered`, `delivered` count, and `weight` of those trips.
- `orders`: the filtered orders, newest first, list shape (for CSV export on the client).

## Testing

- `tests/platform/*` — pure unit tests with fakes (`auth.test.js`, `rateLimiter.test.js`, `authUserService.test.js`) and
  integration tests against `DB_NAME_TEST` via `tests/helpers/db.js` (repositories, SQL analytics, HTTP API on a minimal
  Express app, and the full `createApp`). Fixtures: `tests/platform/fixtures.js`.
- Each DB test file resets the database (`TRUNCATE`) before use; Jest runs in band.
