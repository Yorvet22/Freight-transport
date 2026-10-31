# Freight Transport Management — Specification (v2)

Single source of truth for the v2 rewrite. All code, UI text, comments, docs, seed data and
commit-able content are **English only**. Stack is unchanged: Node.js 18+, Express 4 (CommonJS),
MySQL 8 **and** an in-memory engine (`DB_ENGINE=memory`), vanilla JS + Bootstrap 5 from CDN, no build step.

Principles: **SDD** (this file is the contract — change it before changing behaviour), **TDD**
(write the failing test first, then the code), **KISS/YAGNI** (no new frameworks, smallest thing
that works), layered architecture `routes → controllers → services → repositories`, dependency
injection through factories/constructors, no globals.

---

## 1. Domain enums (stored values = codes; UI shows labels)

| Enum | Codes → Labels |
|---|---|
| Order status | `new` New · `in_transit` In Transit · `delivered` Delivered · `cancelled` Cancelled |
| Order type | `inbound` Inbound (to our warehouse) · `outbound` Outbound (from our warehouse) · `transfer` Transfer (warehouse → warehouse) |
| Vehicle status | `available` Available · `on_trip` On Trip · `maintenance` Maintenance |
| User role | `admin` · `dispatcher` · `viewer` |

Allowed order status transitions (anything else → `409 INVALID_TRANSITION`):
`new → in_transit`, `new → cancelled`, `in_transit → delivered`, `in_transit → cancelled`.

## 2. Data model (MySQL column names = JSON field names, camelCase)

**warehouses**: `id` PK · `code` VARCHAR(20) UNIQUE (e.g. `WH-01`) · `name` VARCHAR(100) · `address` VARCHAR(200) ·
`city` VARCHAR(100) · `capacityPallets` INT NULL · `managerName` VARCHAR(100) NULL · `phone` VARCHAR(30) NULL ·
`isActive` BOOLEAN default true · `createdAt` DATETIME.

**vehicles**: `id` PK · `model` VARCHAR(100) · `licensePlate` VARCHAR(20) UNIQUE · `driverName` VARCHAR(100) ·
`capacityKg` INT NULL · `status` VARCHAR(20) default `available`.

**orders**: `id` PK · `orderNumber` VARCHAR(20) UNIQUE — derived from the auto-increment id as
`ORD-` + id zero-padded to 6 digits (race-free; no "last + 1") · `type` VARCHAR(20) · `clientName` VARCHAR(100) ·
`pickupAddress` VARCHAR(200) · `deliveryAddress` VARCHAR(200) · `cargoDescription` TEXT · `cargoWeight` DECIMAL(10,2) ·
`status` VARCHAR(20) default `new` · `vehicleId` FK→vehicles NULL ON DELETE SET NULL ·
`originWarehouseId` FK→warehouses NULL ON DELETE SET NULL · `destinationWarehouseId` FK→warehouses NULL ON DELETE SET NULL ·
`plannedDeliveryDate` DATE NULL · `pickupWindowStart` DATETIME NULL · `pickupWindowEnd` DATETIME NULL · `dockNumber` VARCHAR(10) NULL ·
`podRecipientName` VARCHAR(100) NULL · `podSignature` MEDIUMTEXT NULL (PNG data URL) · `podNote` VARCHAR(500) NULL ·
`createdAt` DATETIME · `deliveredAt` DATETIME NULL. Indexes on status, type, vehicleId, both warehouse ids.

**order_status_history**: `id` PK · `orderId` FK→orders ON DELETE CASCADE · `fromStatus` NULL (null for creation) ·
`toStatus` · `changedAt` DATETIME · `changedBy` VARCHAR(50) NULL (username) · `note` VARCHAR(500) NULL.

**users**: `id` PK · `username` VARCHAR(50) UNIQUE · `passwordHash` VARCHAR(200) · `role` VARCHAR(20) · `createdAt` DATETIME.
Hash format: `scrypt$<saltHex>$<hashHex>` using Node `crypto.scryptSync(password, salt, 64)` (no extra deps).

Order JSON responses additionally include read-only joined fields:
`truckPlate`, `driverName` (from vehicle, null if none), `originWarehouseName`, `destinationWarehouseName`.
`podSignature` is returned only by `GET /api/orders/:id` (omitted from lists).

## 3. Business rules

- **BR1 type ↔ warehouses**: `inbound` requires `destinationWarehouseId`; `outbound` requires `originWarehouseId`;
  `transfer` requires both and they must differ. Referenced warehouses must exist and be active → else 400 VALIDATION_ERROR.
- **BR2 vehicle assignment**: `vehicleId` (optional on create/update) must exist and must not be in `maintenance`.
- **BR3 status flow** (only via `PATCH /api/orders/:id/status`; POST always creates `new`, PUT never changes status):
  - → `in_transit`: order must have a vehicle; vehicle must be `available`; vehicle becomes `on_trip`.
  - → `delivered`: requires `podRecipientName`; optional `podSignature` (must start with `data:image/png;base64,`, ≤ 500 KB) and `podNote`; sets `deliveredAt=now`; vehicle becomes `available`.
  - → `cancelled`: if it was `in_transit`, vehicle becomes `available`.
  - Every change (and creation) appends an `order_status_history` row with `changedBy = req.user.username`.
- **BR4**: orders in `in_transit`/`delivered` cannot be edited via PUT or deleted → `409 ORDER_LOCKED`.
  Changing `vehicleId` of an order is allowed only while `new`.
- **BR5**: vehicle `on_trip` cannot be deleted (`409 VEHICLE_IN_USE`) and its status cannot be changed manually via PUT
  (`409 VEHICLE_IN_USE`). Manual vehicle status via PUT may only be `available` or `maintenance`.
- **BR6**: warehouse referenced by any `new`/`in_transit` order cannot be deleted → `409 WAREHOUSE_IN_USE`.
- **Validation**: required strings trimmed and non-empty, max lengths per schema (VARCHAR limits), `cargoWeight` number > 0
  and ≤ 100000, ids positive integers, dates ISO strings, `pickupWindowEnd` ≥ `pickupWindowStart`.

## 4. Errors (all API errors)

`{ "error": "<CODE>", "message": "<English sentence>", "details"?: [{ "field", "message" }] }`
Thrown in services as `new AppError(code, status, message, details)` from `backend/src/errors.js`.

| Code | HTTP |
|---|---|
| VALIDATION_ERROR, INVALID_JSON, INVALID_ID, INVALID_QUERY | 400 |
| UNAUTHORIZED | 401 |
| FORBIDDEN | 403 |
| NOT_FOUND (also unknown `/api/*` routes) | 404 |
| DUPLICATE_PLATE, DUPLICATE_CODE, DUPLICATE_USERNAME, VEHICLE_IN_USE, VEHICLE_UNAVAILABLE, WAREHOUSE_IN_USE, ORDER_LOCKED, INVALID_TRANSITION | 409 |
| INTERNAL_SERVER_ERROR | 500 (only unexpected errors are logged) |

MySQL `ER_DUP_ENTRY` must be mapped to the matching 409, malformed JSON body to 400 INVALID_JSON.

## 5. API (base `/api`, JSON, cookie auth)

List endpoints accept `page` (default 1), `limit` (default 20, max 500), `sort` (whitelisted field), `dir` (`asc|desc`),
`q` (text search) and filters; they return `{ items, total, page, limit }`. Invalid params → 400 INVALID_QUERY.

| Method & path | Role (write) | Notes |
|---|---|---|
| GET `/health` | public | `{ status: "ok", engine: "mysql"|"memory" }` |
| POST `/auth/login` | public | body `{username,password}` → sets cookie, returns `{ user: {id,username,role} }`; 401 on bad creds |
| POST `/auth/logout` | any | clears cookie, 204 |
| GET `/auth/me` | any | `{ user }` |
| GET `/orders` | read | filters: `status`, `type`, `vehicleId`, `warehouseId` (+ `direction=inbound|outbound|any`), `q` (orderNumber/clientName/cargoDescription/plate/driver); sort: `createdAt` (default desc), `orderNumber`, `clientName`, `cargoWeight`, `status`, `plannedDeliveryDate` |
| GET `/orders/:id` | read | includes `podSignature` |
| GET `/orders/:id/history` | read | array, oldest first |
| POST `/orders` | dispatcher+ | 201 |
| PUT `/orders/:id` | dispatcher+ | all editable fields except status/POD |
| PATCH `/orders/:id/status` | dispatcher+ | `{ status, note?, podRecipientName?, podSignature?, podNote? }` |
| DELETE `/orders/:id` | dispatcher+ | 204 |
| GET `/vehicles` | read | filters `status`, `q`; sort `licensePlate` (default asc), `model`, `driverName`, `status` |
| GET/POST/PUT/DELETE `/vehicles[/:id]` | dispatcher+ | |
| GET `/warehouses` | read | filters `active` (`true|false`), `q`; sort `code` (default asc), `name`, `city` |
| GET `/warehouses/:id` | read | |
| GET `/warehouses/:id/schedule?date=YYYY-MM-DD` | read | `{ date, departures: [orders with originWarehouseId=id and pickupWindowStart on date, sorted by window], arrivals: [orders with destinationWarehouseId=id and plannedDeliveryDate=date] }` (date defaults to today) |
| POST/PUT/DELETE `/warehouses[/:id]` | admin | |
| GET `/dashboard/kpis` | read | see §6 |
| GET `/reports/summary` | read | filters `from`, `to` (createdAt date range), `warehouseId`, `vehicleId`; see §6 |
| GET/POST `/users`, DELETE `/users/:id` | admin | users list never returns `passwordHash`; admin cannot delete self (400 VALIDATION_ERROR) |

Roles: `viewer` = GET only; `dispatcher` = viewer + write orders & vehicles; `admin` = everything.

## 6. Analytics payloads

`GET /dashboard/kpis` →
```json
{ "orders": { "total":0, "new":0, "in_transit":0, "delivered":0, "cancelled":0 },
  "vehicles": { "total":0, "available":0, "on_trip":0, "maintenance":0 },
  "onTimeRate": 0.0,            // delivered with deliveredAt::date <= plannedDeliveryDate / delivered having a planned date; null if none
  "fleetUtilization": 0.0,      // on_trip / (total - maintenance); null if denominator 0
  "avgTransitHours": 0.0,       // avg(deliveredAt - in_transit history changedAt); null if none
  "ordersPerDay": [{ "date":"YYYY-MM-DD", "count":0 }],   // last 14 days incl. today, zero-filled
  "warehouses": [{ "id":1, "code":"WH-01", "name":"…", "inbound":0, "outbound":0 }],  // inbound = destination, outbound = origin
  "recentOrders": [ /* 5 latest orders, list shape */ ] }
```
Rates are fractions 0..1 rounded to 4 decimals.

`GET /reports/summary` →
```json
{ "filters": {…echo…}, "totals": { "orders":0, "delivered":0, "inTransit":0, "cancelled":0, "new":0, "totalWeight":0, "deliveryRate":0 },
  "byWarehouse": [{ "warehouseId":1, "code":"WH-01", "name":"…", "inbound":0, "outbound":0, "weight":0 }],
  "byVehicle":   [{ "vehicleId":1, "licensePlate":"…", "driverName":"…", "trips":0, "delivered":0, "weight":0 }],
  "orders": [ /* filtered orders, list shape, for export */ ] }
```

## 7. Repository interface (both engines implement identical methods)

- `orderRepo`: `list(query) → {items,total}`, `listAll(filters?)`, `findById(id)`, `create(data) → id` (sets orderNumber from id), `update(id, data)`, `deleteById(id)`.
- `vehicleRepo`: `list`, `listAll`, `findById`, `findByPlate`, `create`, `update`, `deleteById`.
- `warehouseRepo`: `list`, `listAll`, `findById`, `findByCode`, `create`, `update`, `deleteById`, `countOpenOrders(id)`.
- `historyRepo`: `add(entry)`, `findByOrderId(orderId)`, `listAll()`.
- `userRepo`: `findByUsername`, `findById`, `listAll`, `create`, `deleteById`.
In-memory repos receive the other repos they need for joins via constructor.

## 8. Runtime & config

`backend/src/app.js` exports `createApp(options)`; `server.js` builds options from env.
Options: `{ engine: 'mysql'|'memory', seedDemo: bool, authDisabled: bool, sessionSecret }`.
Env: `PORT`(3000) · `DB_ENGINE`(`mysql`) · `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` ·
`SESSION_SECRET` · `AUTH_DISABLED`(`false`) · `SEED_DEMO`(`true` in memory mode).
With `authDisabled`, every request acts as `{ id:0, username:'system', role:'admin' }` (used by domain tests).

Auth: stateless HMAC-SHA256 signed token `base64url(payload).base64url(sig)`, payload `{uid, username, role, exp}` (8h),
cookie `ft_token` (HttpOnly, SameSite=Lax, Path=/). Login responds 401 `UNAUTHORIZED` with a generic message.
Demo users (memory engine + seed script): `admin/admin123`, `dispatcher/dispatcher123`, `viewer/viewer123` — documented as demo only.

Demo data (`backend/src/seed/demoData.js`, used by memory engine and `npm run seed` for MySQL):
4 warehouses (Kyiv, Lviv, Odesa, Dnipro — English names), 10 vehicles, ~60 orders spread over the last 30 days across
all types/statuses with consistent vehicle states, history rows, planned dates and pickup windows. Fictional English company names only.

## 9. Frontend

Pages (`frontend/pages`): `login.html`, `index.html` (dashboard), `orders.html`, `vehicles.html`, `warehouses.html`,
`reports.html`, `users.html` (admin). The old "testing matrix" page is removed.
Shared JS (`frontend/js`): `api.js` (fetch wrapper, base `/api`, `credentials:'same-origin'`, parses errors safely,
401 → redirect to `/login.html`), `ui.js` (escapeHtml, toasts, confirm modal, formatDate/formatDateTime, status/type
labels & badge classes, pagination renderer, debounce, form-error rendering), `layout.js` (sidebar + top bar with
current user, logout, theme toggle; hides write controls for viewers via `data-requires-role`).
Never interpolate data into `innerHTML` without `escapeHtml`; no inline `onclick` handlers — use event delegation with `data-*`.
Design: modern sidebar layout, Inter font (Google Fonts), light/dark theme via Bootstrap 5.3 `data-bs-theme`, KPI cards,
consistent status badge colours, responsive down to 375 px, empty states and loading skeletons.

## 10. Resolved decisions (added during implementation)

- Usernames: 1–50 chars `[A-Za-z0-9._-]`, unique case-insensitively; passwords 6–200 chars.
- Login: missing/non-string fields → 400 VALIDATION_ERROR; wrong credentials → 401 UNAUTHORIZED.
- `authenticate` re-loads the user from the repository on every request; deleted users → 401.
- `avgTransitHours` rounded to 2 decimals; days are bucketed by UTC date.
- Reports: `from`/`to` inclusive, `from > to` → 400 INVALID_QUERY; `warehouseId` matches origin OR destination;
  `trips` counts `in_transit` + `delivered` orders; `byWarehouse`/`byVehicle` list all entities (or only the filtered one).
- `createPlatform` additionally accepts optional `repos.userRepo` and `logger`, and returns `userRepo`.
- `orders.orderNumber` is nullable at the DB level; it is set right after INSERT in the same transaction.
- Order creation and status changes (order + vehicle + history) are atomic (single MySQL transaction).
- Memory engine: repositories share one in-memory store object instead of referencing each other.
- All calendar dates (schedule, report filters, dashboard buckets) are **UTC** days.
- Dispatch without a vehicle → 400 VALIDATION_ERROR (`vehicleId`); vehicle not available → 409 VEHICLE_UNAVAILABLE;
  oversized body → 400 VALIDATION_ERROR; duplicate on an unknown unique key → 409 CONFLICT.
- `cargoDescription` ≤ 2000 chars; `capacityKg` ≥ 1; `capacityPallets` ≥ 0. PUT omitting `status`/`isActive` keeps the current value;
  BR1/BR2 are re-checked on PUT only when the warehouse/vehicle ids change.

## 11. v3 — MySQL-only backend (supersedes the in-memory engine)

- The in-memory engine is **removed** (runtime and tests). MySQL 8 is the only storage. `DB_ENGINE`/`SEED_DEMO` env vars are gone.
- Databases: `DB_NAME` (dev, default `freightflow`) and `DB_NAME_TEST` (default `freightflow_test`). Test tooling refuses to
  touch any database whose name does not end in `_test`. The legacy v1 database `freight_transport` is never touched.
- Schema is managed by versioned migrations in `database/migrations/NNN_name.sql`, applied in order by
  `backend/src/db/migrate.js` and recorded in a `schema_migrations(version, name, appliedAt)` table (idempotent, each file in a transaction where possible).
- npm scripts: `db:create` (CREATE DATABASE IF NOT EXISTS utf8mb4), `db:migrate`, `db:seed` (demo data, refuses if data exists unless `--force`),
  `db:setup` (= create + migrate + seed if empty), `db:reset` (dev/test only: drop + setup).
- `backend/src/db/`: `pool.js` (`createPool(config)`; UTC, `dateStrings:['DATE']`, `decimalNumbers`, `namedPlaceholders:false`),
  `transaction.js` (`withTransaction(pool, async (conn) => …)` — commit/rollback/release), `migrate.js`.
- Tests: unit tests use fakes (no DB); repository/API/platform integration tests run against `DB_NAME_TEST` using
  `backend/tests/helpers/db.js` (`getTestPool()`, `resetDatabase()` = TRUNCATE all tables except schema_migrations,
  `seedDemo(pool, {now})`, `closeTestPool()`); Jest `globalSetup` creates+migrates the test DB once. Jest runs in band.
- Dashboard and report aggregates are computed **in SQL** (GROUP BY), not by loading all rows into JS.
- Server: `GET /api/health` pings the DB (`{status:'ok', db:'up'}` or 503 `{status:'error', db:'down'}`); graceful shutdown on SIGINT/SIGTERM
  (close HTTP server then pool); fails fast at startup with a clear message if MySQL is unreachable or migrations are pending.
- Security: standard security headers (helmet), login rate limiting (10 attempts / 15 min per IP+username, 429 `TOO_MANY_REQUESTS`),
  `SESSION_SECRET` required when `NODE_ENV=production`, CORS restricted to `CORS_ORIGIN` (unset = same-origin only).
- Audit: `audit_log(id, userId NULL, username, action, entity, entityId, details JSON NULL, createdAt)` written for create/update/delete/status changes
  of orders, vehicles, warehouses, users. `GET /api/audit?entity=&entityId=&page=&limit=` (admin).
- Error table addition: `TOO_MANY_REQUESTS` → 429. In production the session cookie is `Secure`; `TRUST_PROXY` env sets Express `trust proxy`.
- `audit.record` accepts an optional transaction connection. Audit failures are logged and never fail the request.
- Wherever earlier sections mention the in-memory engine, `DB_ENGINE`, `SEED_DEMO` or `engine` in `/api/health`, §11 overrides them.
