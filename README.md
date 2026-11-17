# Secure Notes – Backend

REST API for a note-taking app with JWT auth and role-based access (`user`, `admin`).

Stack: Node.js, Express 5, TypeScript, MongoDB + Mongoose, JWT (`jsonwebtoken`), bcrypt password hashing (`bcryptjs`).

## Getting started

Requirements: Node.js 22+, pnpm, and a MongoDB instance (local or Atlas).

```bash
pnpm install
```

Create a `.env` file in this folder:

```
PORT=4000
MONGO_URI=mongodb://127.0.0.1:27017/secure-notes
JWT_SECRET=<random string, at least 32 characters>
JWT_EXPIRES_IN=1d
CLIENT_URL=http://localhost:5173
```

`CLIENT_URL` is the frontend origin allowed by CORS. Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

Create the first admin (or promote an existing account), then start the server:

```bash
pnpm create-admin admin@example.com 'StrongPassword1' 'Admin'
pnpm dev
```

The API runs on `http://localhost:4000`. Other scripts: `pnpm build`, `pnpm start`, `pnpm typecheck`.

Tests: `pnpm test` runs end-to-end API tests against a real MongoDB. They use a separate `secure-notes-test` database, which is dropped on each run (set `TEST_MONGO_URI` to change it). They cover auth, note ownership, admin rules, both aggregations, the exact set of indexes, and that queries hit an index.

Code quality: `pnpm lint` (ESLint), `pnpm format` / `pnpm format:check` (Prettier). A Husky pre-commit hook runs lint-staged, which lints and formats only the staged files.

## Roles

- **user** – create, read, update and delete their own notes; edit their profile and interests; write posts.
- **admin** – everything a user can do, plus manage users (list, add, update, remove) and read everyone's notes.

Anyone can register; new accounts always get the `user` role. Only an admin can grant `admin`.

## API

Every route except `/api/auth/*` needs an `Authorization: Bearer <token>` header.
List endpoints accept `?page=1&limit=10` (max 100) and return:

```json
{ "items": [], "page": 1, "limit": 10, "total": 0, "totalPages": 0 }
```

| Method | Path                     | Access        | Description                                         |
| ------ | ------------------------ | ------------- | --------------------------------------------------- |
| POST   | `/api/auth/register`     | public        | `{ name, email, password }` → `{ token, user }`     |
| POST   | `/api/auth/login`        | public        | `{ email, password }` → `{ token, user }`           |
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
| DELETE | `/api/users/:id`         | admin         | Delete a user with their notes and posts            |

Errors come back as `{ "message": "..." }` with a matching status code (400, 401, 403, 404, 409, 500).

## Indexes

Every index is declared with `schema.index()` in `src/models`. The default `_id` index is used wherever possible, and no other indexes are created.

| Collection | Index                         | Used by                                                                                                |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| users      | `{ email: 1 }` unique         | Login and register lookup; also blocks duplicate emails                                                |
| users      | `{ interests: 1 }` (multikey) | `$match` at the start of the group-by-interest pipeline                                                |
| notes      | `{ owner: 1, _id: -1 }`       | "My notes" list (filter by owner, newest first), its count, and cleanup when a user is deleted         |
| posts      | `{ author: 1, _id: -1 }`      | The `$lookup` in "posts of a user" (match by author, newest first), and cleanup when a user is deleted |

Queries that only need `_id`:

- `GET /api/users/me`, `GET /api/users/:id`, `GET /api/notes/:id`, and note update and delete (`{ _id, owner }`)
- Admin user list and admin all-notes list, both sorted by `_id: -1`. Their totals use `estimatedDocumentCount()`, which reads collection metadata instead of scanning.
- The `$match` on `_id` in the posts pipeline, and the `populate('owner')` lookup on the admin notes list

Sorting by `_id` instead of `createdAt` gives the same order, because ObjectIds start with a timestamp. That way the lists don't need extra indexes.

## Aggregations

Both live in `src/routes/users.ts`.

**Scenario 1: users grouped by interest.** One `User.aggregate()` call:
`$match { interests: { $gt: '' } }` → `$project` → `$unwind` → `$group` by interest → `$sort` → `$facet` (page + total).
The `$gt: ''` range runs on the multikey `interests` index, so the pipeline starts with an index scan and skips users with no interests. Interests are trimmed, lower-cased and de-duplicated on save, so each user appears once per group. Each group lists up to 20 users (`$firstN`) so one popular interest can't exceed the 16 MB document limit. `count` is always the full number.

**Scenario 2: posts of a user.** One `User.aggregate()` call:
`$match { _id }` → `$lookup` (page: `$sort { _id: -1 }` → `$skip` → `$limit`) → `$lookup` (total: `$project { _id: 1 }` → `$count`).
The `$match` uses the `_id` index. Both lookups use `{ author: 1, _id: -1 }`. The first reads only the requested page. The second only needs `_id`, so the index answers the count without reading the posts.

## Security notes

- Passwords are hashed with bcrypt (cost 12) in a pre-save hook and are never returned (`select: false` plus a `toJSON` transform).
- Login returns the same error for an unknown email and a wrong password.
- The JWT holds only the user id and role. The user is loaded again on every request, so deleted users and role changes take effect immediately.
- Request fields are checked to be strings before they reach a query, which blocks operator injection like `{ "email": { "$gt": "" } }`. Only known fields are copied from the body, so a user can't set their own role.
- Admins can't delete themselves or remove their own admin role, so the app can't lose its last admin by accident.
