# Secure Notes – Backend

REST API for a note-taking app with JWT auth and role-based access (`user`, `admin`).

Stack: Node.js, Express 5, TypeScript, MongoDB + Mongoose, Zod (request validation), JWT (`jsonwebtoken`), bcrypt password hashing (`bcryptjs`).

## Getting started

Requirements: Node.js 22.9+, pnpm, and a MongoDB instance (local or Atlas).

```bash
pnpm install
```

Copy `env.example` to `.env` and fill it in (`.env` is git-ignored and must never be committed):

```
PORT=4000
MONGO_URI=mongodb://127.0.0.1:27017/secure-notes
JWT_SECRET=<random string, at least 32 characters>
ACCESS_TOKEN_EXPIRES_IN=15m
REFRESH_TOKEN_DAYS=7
CLIENT_URL=http://localhost:5173
TRUST_PROXY=0
LOG_LEVEL=info
DEMO_ADMIN_EMAIL=demo.admin@example.com
DEMO_ADMIN_PASSWORD=DemoAdmin@2026
```

For MongoDB Atlas, use the `mongodb+srv://` string from Atlas and put the database name before the `?`: `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/secure-notes?retryWrites=true&w=majority`. Without a name, everything goes into a database called `test`. Also allow your server's IP under Atlas → Network Access (`0.0.0.0/0` for Render, whose outgoing IPs change).

If the server fails with `querySrv ECONNREFUSED`, Node can't resolve the `mongodb+srv://` DNS record on that machine. Use the standard connection string instead (Atlas → Connect → Drivers, older driver version), which lists the three hosts directly: `mongodb://<user>:<password>@<host-00>:27017,<host-01>:27017,<host-02>:27017/secure-notes?ssl=true&replicaSet=<replica-set>&authSource=admin`.

`CLIENT_URL` is the frontend origin allowed by CORS. `TRUST_PROXY` is the number of proxies in front of the app: keep `0` locally and set `2` on Render behind the Vercel `/api` proxy (see Security). Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

All variables are validated at startup (`src/config.ts`). A missing or malformed value, like `REFRESH_TOKEN_DAYS=7d`, stops the server with a message naming the variable.

Logging uses `pino`. Each request is logged as one line with its id, method, URL, status and response time. Headers and bodies are never logged, so cookies, tokens and passwords stay out of the logs. Output is readable in development (`pino-pretty`) and JSON when `NODE_ENV=production`. Set the level with `LOG_LEVEL` (default `info`).

### Demo admin (for reviewers)

When `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD` are set, the server makes sure that admin exists on every startup. It creates the account if it's missing, and restores the admin role and password if someone changed them. The deployed demo uses:

| Email                    | Password         |
| ------------------------ | ---------------- |
| `demo.admin@example.com` | `DemoAdmin@2026` |

Anyone can also register a normal user account from the login page. This is a public demo account: don't store anything private in it. Leave both variables unset to turn it off.

### Your own admin

Create an admin (or promote an existing account), then start the server:

```bash
pnpm create-admin admin@example.com 'StrongPassword1' 'Admin'
pnpm dev
```

On `SIGTERM` or `SIGINT` (Ctrl+C), the server stops taking new connections, lets running requests finish (up to 10 seconds), closes the MongoDB connection and exits.

The API runs on `http://localhost:4000`. Other scripts: `pnpm build`, `pnpm start` (runs `dist/`; reads `.env` if present, otherwise the real environment), `pnpm typecheck`.

Tests: `pnpm test` runs end-to-end API tests against a real MongoDB. They use a separate `secure-notes-test` database, which is dropped on each run (set `TEST_MONGO_URI` to change it). They cover auth, refresh token rotation and reuse detection, note ownership, admin rules, both aggregations, the exact set of indexes, that queries hit an index, the demo admin, and environment validation. Never point `TEST_MONGO_URI` at a real database.

Code quality: `pnpm lint` (ESLint), `pnpm format` / `pnpm format:check` (Prettier). A Husky pre-commit hook runs lint-staged, which lints and formats only the staged files.

Commits follow [Conventional Commits](https://www.conventionalcommits.org) (`feat(auth): ...`, `fix(notes): ...`, `docs: ...`). A Husky `commit-msg` hook runs commitlint and rejects any other format. Run `pnpm commit` for a guided prompt (commitizen with `@commitlint/cz-commitlint`, so the prompt follows the same rules).

## Project structure

The code is split into layers. Each layer only calls the one below it:

```
src/
  routes/        URL + HTTP method -> middleware -> controller (no logic)
  controllers/   HTTP only: parse input with Zod, call a service, set cookies, send the response
  services/      business rules and database work, no req/res (ownership checks, aggregations)
  models/        Mongoose schemas, indexes and shared field limits
  middleware/    authentication, role checks, error handling
  utils/         HttpError and pagination helpers
  scripts/       create-admin CLI
  app.ts         Express app: security middleware and routers
  index.ts       startup (MongoDB, demo admin) and graceful shutdown
  logger.ts      pino logger
  session.ts     access and refresh token cookies
  validation.ts  Zod request schemas
  config.ts      validated environment variables
```

## Roles

- **user** – create, read, update and delete their own notes; edit their profile and interests; write posts.
- **admin** – everything a user can do, plus manage users (list, add, update, remove) and read everyone's notes.

Anyone can register; new accounts always get the `user` role. Only an admin can grant `admin`.

## API

Login and register set two httpOnly cookies: `accessToken`, a 15-minute access JWT, and `refreshToken`, a 7-day refresh token sent only to `/api/auth`. Every route except `/api/auth/*` needs the `accessToken` cookie. When it expires, the client calls `POST /api/auth/refresh` to get a new pair. Browsers send the cookies automatically with `credentials: 'include'`.

### Response format

Every response uses the same envelope, built in `src/utils/http.ts`. The HTTP status code always matches `success`.

```jsonc
// a single item (note, user, post)
{ "success": true, "data": { "_id": "...", "title": "..." } }

// a list
{ "success": true, "data": [], "meta": { "page": 1, "limit": 10, "total": 0, "totalPages": 0 } }

// an error (400, 401, 403, 404, 409, 429, 500)
{ "success": false, "message": "Note not found" }
```

Deletes and logout return `204 No Content` with an empty body.

List endpoints accept `?page=1&limit=10` (`limit` max 100). Missing or out-of-range values fall back to page 1 and 10 per page. `GET /api/users/:id/posts` also puts the author in `meta.user`.

### Endpoints

| Method | Path                     | Access        | Description                                         |
| ------ | ------------------------ | ------------- | --------------------------------------------------- |
| POST   | `/api/auth/register`     | public        | `{ name, email, password }` → user + cookies        |
| POST   | `/api/auth/login`        | public        | `{ email, password }` → user + cookies              |
| POST   | `/api/auth/refresh`      | refresh token | Rotates the refresh token → user + cookies          |
| POST   | `/api/auth/logout`       | public        | Revokes the refresh token and clears both cookies   |
| GET    | `/api/users/me`          | user          | Own profile                                         |
| PATCH  | `/api/users/me`          | user          | `{ name?, interests? }`                             |
| GET    | `/api/users/by-interest` | user          | Users grouped by interest (aggregation, scenario 1) |
| GET    | `/api/users/:id/posts`   | user          | Posts of a user (`$lookup` aggregation, scenario 2) |
| POST   | `/api/posts`             | user          | `{ title, body }`                                   |
| GET    | `/api/notes`             | user          | Own notes, newest first                             |
| POST   | `/api/notes`             | user          | `{ title, content? }`                               |
| GET    | `/api/notes/:id`         | owner / admin | Single note                                         |
| PATCH  | `/api/notes/:id`         | owner         | `{ title?, content? }`                              |
| DELETE | `/api/notes/:id`         | owner         | Delete note                                         |
| GET    | `/api/notes/all`         | admin         | Everyone's notes, with owner name and email         |
| GET    | `/api/users`             | admin         | List users                                          |
| POST   | `/api/users`             | admin         | `{ name, email, password, role?, interests? }`      |
| GET    | `/api/users/:id`         | admin         | Single user                                         |
| PATCH  | `/api/users/:id`         | admin         | `{ name?, email?, password?, role?, interests? }`   |
| DELETE | `/api/users/:id`         | admin         | Delete a user with their notes, posts and sessions  |

## Indexes

Every index is declared with `schema.index()` in `src/models`. The default `_id` index is used wherever possible, and no other indexes are created.

| Collection    | Index                         | Used by                                                                                                |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| users         | `{ email: 1 }` unique         | Login and register lookup; also blocks duplicate emails                                                |
| users         | `{ interests: 1 }` (multikey) | `$match` at the start of the group-by-interest pipeline                                                |
| notes         | `{ owner: 1, _id: -1 }`       | "My notes" list (filter by owner, newest first), its count, and cleanup when a user is deleted         |
| posts         | `{ author: 1, _id: -1 }`      | The `$lookup` in "posts of a user" (match by author, newest first), and cleanup when a user is deleted |
| refreshtokens | `{ tokenHash: 1 }` unique     | Finding the token on every refresh and logout                                                          |
| refreshtokens | `{ user: 1 }`                 | Revoking all of a user's sessions (token reuse, password change, user deleted)                         |
| refreshtokens | `{ expiresAt: 1 }` TTL        | MongoDB deletes expired tokens on its own, so the collection doesn't grow forever                      |

Queries that only need `_id`:

- `GET /api/users/me`, `GET /api/users/:id`, `GET /api/notes/:id`, and note update and delete (`{ _id, owner }`)
- Admin user list and admin all-notes list, both sorted by `_id: -1`. Their totals use `estimatedDocumentCount()`, which reads collection metadata instead of scanning.
- The `$match` on `_id` in the posts pipeline, and the `populate('owner')` lookup on the admin notes list

Sorting by `_id` instead of `createdAt` gives the same order, because ObjectIds start with a timestamp. That way the lists don't need extra indexes.

## Aggregations

Both live in `src/services/users.service.ts` (`groupByInterest` and `postsOfUser`).

**Scenario 1: users grouped by interest.** One `User.aggregate()` call:
`$match { interests: { $gt: '' } }` → `$project` → `$unwind` → `$group` by interest → `$sort` → `$facet` (page + total).
The `$gt: ''` range runs on the multikey `interests` index, so the pipeline starts with an index scan and skips users with no interests. Interests are trimmed, lower-cased and de-duplicated on save, so each user appears once per group. Each group lists up to 20 users (`$firstN`) so one popular interest can't exceed the 16 MB document limit. `count` is always the full number.

**Scenario 2: posts of a user.** One `User.aggregate()` call:
`$match { _id }` → `$lookup` (page: `$sort { _id: -1 }` → `$skip` → `$limit`) → `$lookup` (total: `$project { _id: 1 }` → `$count`).
The `$match` uses the `_id` index. Both lookups use `{ author: 1, _id: -1 }`. The first reads only the requested page. The second only needs `_id`, so the index answers the count without reading the posts.

## Security notes

**Sessions**

- Both tokens are sent only in `httpOnly`, `SameSite=Strict` cookies (`Secure` when `NODE_ENV=production`). Page scripts can't read them, so an XSS bug can't steal them. Browsers don't send them on requests started from other sites, which blocks CSRF. They never appear in a response body.
- **Access token:** a JWT that lasts 15 minutes (`ACCESS_TOKEN_EXPIRES_IN`). It is signed and verified with HS256 only, so tokens with `alg: none` or another secret are rejected. `JWT_SECRET` must be at least 32 characters, or the server won't start. The JWT holds only the user id and role. The user is loaded again on every request, so deleted users and role changes take effect immediately.
- **Refresh token:** 32 random bytes that last 7 days (`REFRESH_TOKEN_DAYS`). Only its SHA-256 hash is stored (`refreshtokens` collection), so a database leak doesn't give out working tokens. Its cookie is scoped to `/api/auth`, so it isn't attached to normal API calls.
- **Rotation and reuse detection:** each refresh token works exactly once, claimed atomically with `findOneAndUpdate`. If an already-used token comes back more than 10 seconds after it was used, someone else has a copy, so every session of that user is revoked. A reuse within 10 seconds is two tabs refreshing at the same moment, so it just fails without revoking anything.
- Changing a password ends every session that started before the change, for both access and refresh tokens (`passwordChangedAt`).
- `POST /api/auth/logout` deletes this browser's refresh token and clears both cookies. Deleting a user deletes all their refresh tokens.

**Passwords and login**

- Passwords are hashed with bcrypt (cost 12) in a pre-save hook and are never returned (`select: false` plus a `toJSON` transform). They must be 8 to 72 bytes, because bcrypt ignores anything after 72 bytes.
- Login returns the same error and takes the same time for an unknown email and a wrong password. An unknown email is still checked against a dummy hash, so response time doesn't reveal which emails exist.
- Rate limits: 10 failed logins per IP per 15 minutes, 30 registrations per IP per hour, and 60 token refreshes per IP per 15 minutes (`express-rate-limit`). Behind proxies, set `TRUST_PROXY` to how many there are (`2` on Render behind the Vercel `/api` proxy), so the limit counts each real visitor. With the default `0`, every request through a proxy would share one IP. Requests sent straight to the Render URL can fake a forwarded IP and get around the limit, because the free plan can't restrict who reaches Render directly.

**HTTP**

- `helmet` sets security headers (`nosniff`, frame blocking, HSTS, a strict CSP for API responses) and removes `X-Powered-By`.
- CORS allows only `CLIENT_URL`, with credentials. The frontend and API must be on the same site (for example `localhost` and `localhost`, or `app.example.com` and `api.example.com`) for the `SameSite=Strict` cookie to be sent. In the deployed setup the frontend calls its own `/api` path and Vercel forwards it to Render, so the browser only ever talks to one site.
- JSON bodies are limited to 100 KB. The models cap lengths (name, email, note and post text, 20 interests of up to 50 characters each) and check email format.

**Data access**

- Every request body and query is parsed with Zod (`src/validation.ts`) before it reaches a handler. Each field has a fixed type, which blocks operator injection like `{ "email": { "$gt": "" } }`. Unknown fields are dropped, so a user can't set their own role. The Mongoose models keep their own rules as a second check at the database level.
- Admins can't delete themselves or remove their own admin role, so the app can't lose its last admin by accident.

## Deployment

The live demo runs on Render (API), Vercel (frontend) and MongoDB Atlas.

1. Render → New Web Service from this repo. Build command `pnpm install && pnpm build`, start command `pnpm start`.
2. Set the environment variables in Render → Environment (there is no `.env` file on Render): `NODE_ENV=production`, `MONGO_URI` (Atlas, with `/secure-notes` as the database), `JWT_SECRET`, `CLIENT_URL` (the Vercel URL), `TRUST_PROXY=2`, and optionally the demo admin variables.
3. The frontend's `vercel.json` forwards `/api/*` to this service, so cookies stay first-party. See the frontend README.

Render's free plan sleeps after 15 minutes without traffic, so the first request after that can take up to a minute.
