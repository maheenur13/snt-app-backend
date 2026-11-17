// End-to-end tests against a real MongoDB. Uses its own database, which is dropped on every run.
// Run with: pnpm test   (override the database with TEST_MONGO_URI)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

process.env.MONGO_URI = process.env.TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/secure-notes-test';
process.env.LOG_LEVEL ??= 'silent';
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';

const { default: mongoose } = await import('mongoose');
const { app } = await import('../src/app.js');
const { User } = await import('../src/models/User.js');
const { Note } = await import('../src/models/Note.js');
const { Post } = await import('../src/models/Post.js');
const { RefreshToken } = await import('../src/models/RefreshToken.js');
const { REUSE_GRACE_MS } = await import('../src/session.js');
const { parseEnv } = await import('../src/config.js');
const { ensureDemoAdmin } = await import('../src/demo-admin.js');

let server: Server;
let baseUrl: string;

// Cookies are sent the way a browser would. `token` is the access token, `refresh` the refresh token.
async function call(path: string, token?: string, method = 'GET', body?: unknown, refresh?: string) {
  const cookies = [token && `accessToken=${token}`, refresh && `refreshToken=${refresh}`].filter(Boolean).join('; ');
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookies && { Cookie: cookies }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies = res.headers.getSetCookie();
  const cookie = (name: string) => setCookies.find((c) => c.startsWith(`${name}=`));
  const value = (name: string) =>
    cookie(name)
      ?.split(';')[0]
      .slice(name.length + 1) || undefined;
  return {
    status: res.status,
    data: res.status === 204 ? null : await res.json(),
    headers: res.headers,
    accessCookie: cookie('accessToken'),
    refreshCookie: cookie('refreshToken'),
    token: value('accessToken'),
    refresh: value('refreshToken'),
  };
}

const refreshSession = (refresh: string) => call('/auth/refresh', undefined, 'POST', undefined, refresh);

async function register(name: string, email: string) {
  const res = await call('/auth/register', undefined, 'POST', { name, email, password: 'password123' });
  return { token: res.token!, refresh: res.refresh!, id: res.data.user._id as string };
}

before(async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  await mongoose.connection.dropDatabase();
  await Promise.all([User.syncIndexes(), Note.syncIndexes(), Post.syncIndexes(), RefreshToken.syncIndexes()]);
  server = app.listen(0);
  const { port } = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${port}/api`;
});

after(async () => {
  server.close();
  await mongoose.disconnect();
});

describe('auth', () => {
  test('register hashes the password and never returns it', async () => {
    const { status, data } = await call('/auth/register', undefined, 'POST', {
      name: 'Ann',
      email: 'Ann@Example.com',
      password: 'password123',
    });
    assert.equal(status, 201);
    assert.equal(data.user.password, undefined);
    assert.equal(data.token, undefined, 'token only travels in the httpOnly cookie');
    const stored = await User.findOne({ email: 'ann@example.com' }).select('+password');
    assert.notEqual(stored!.password, 'password123');
  });

  test('cannot register as admin or reuse an email', async () => {
    const res = await call('/auth/register', undefined, 'POST', {
      name: 'Eve',
      email: 'eve@example.com',
      password: 'password123',
      role: 'admin',
    });
    assert.equal(res.data.user.role, 'user');
    const dup = await call('/auth/register', undefined, 'POST', {
      name: 'Eve',
      email: 'EVE@example.com',
      password: 'password123',
    });
    assert.equal(dup.status, 409);
  });

  test('login rejects wrong passwords and query operators', async () => {
    const wrong = await call('/auth/login', undefined, 'POST', { email: 'ann@example.com', password: 'nope-nope' });
    assert.equal(wrong.status, 401);
    const injected = await call('/auth/login', undefined, 'POST', { email: { $gt: '' }, password: 'password123' });
    assert.equal(injected.status, 400);
    const ok = await call('/auth/login', undefined, 'POST', { email: ' ANN@example.com ', password: 'password123' });
    assert.equal(ok.status, 200);
  });

  test('requests without a valid token are rejected', async () => {
    assert.equal((await call('/notes')).status, 401);
    assert.equal((await call('/notes', 'not-a-token')).status, 401);
  });

  test('both auth cookies are httpOnly and SameSite=Strict', async () => {
    const res = await call('/auth/login', undefined, 'POST', { email: 'ann@example.com', password: 'password123' });
    for (const cookie of [res.accessCookie!, res.refreshCookie!]) {
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Strict/);
    }
    assert.match(res.refreshCookie!, /Path=\/api\/auth/, 'refresh token is only sent to auth endpoints');
    const stored = await RefreshToken.findOne({ user: res.data.user._id });
    assert.notEqual(stored!.tokenHash, res.refresh, 'only a hash is stored');
  });

  test('tokens signed with another secret or algorithm are rejected', async () => {
    const { default: jwt } = await import('jsonwebtoken');
    const user = await User.findOne({ email: 'ann@example.com' });
    const forged = jwt.sign({ role: 'admin' }, 'some-other-secret', { subject: user!.id });
    assert.equal((await call('/users/me', forged)).status, 401);
    const unsigned = jwt.sign({ role: 'admin' }, '', { subject: user!.id, algorithm: 'none' });
    assert.equal((await call('/users/me', unsigned)).status, 401);
  });

  test('invalid input is rejected with a readable message', async () => {
    const bad = (body: object) =>
      call('/auth/register', undefined, 'POST', { name: 'X', password: 'password123', ...body });
    const invalidEmail = await bad({ email: 'not-an-email' });
    assert.equal(invalidEmail.status, 400);
    assert.equal(invalidEmail.data.message, 'Email is not valid');
    assert.equal((await bad({ email: 'typed@example.com', name: { $ne: null } })).status, 400);
    assert.equal((await bad({ email: 'long@example.com', password: 'a'.repeat(73) })).status, 400);
    const { token } = await register('Many', 'many@example.com');
    const tooMany = Array.from({ length: 21 }, (_, i) => `topic-${i}`);
    assert.equal((await call('/users/me', token, 'PATCH', { interests: tooMany })).status, 400);
  });

  test('logout clears the cookies and revokes the refresh token', async () => {
    const session = await register('Leaving', 'leaving@example.com');
    const res = await call('/auth/logout', session.token, 'POST', undefined, session.refresh);
    assert.equal(res.status, 204);
    assert.match(res.accessCookie!, /Expires=Thu, 01 Jan 1970/);
    assert.match(res.refreshCookie!, /Expires=Thu, 01 Jan 1970/);
    assert.equal((await refreshSession(session.refresh)).status, 401);
  });

  test('security headers are set and CORS only allows the client origin', async () => {
    const res = await call('/auth/logout', undefined, 'POST');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);

    const preflight = await fetch(`${baseUrl}/notes`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');

    const evil = await fetch(`${baseUrl}/notes`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
    });
    assert.notEqual(evil.headers.get('access-control-allow-origin'), 'https://evil.example');
  });
});

describe('refresh tokens', () => {
  const hash = (token: string) => createHash('sha256').update(token).digest('hex');

  test('refresh rotates both tokens and the new access token works', async () => {
    const first = await register('Rotator', 'rotator@example.com');
    const next = await refreshSession(first.refresh);
    assert.equal(next.status, 200);
    assert.equal(next.data.user.email, 'rotator@example.com');
    assert.ok(next.token && next.refresh);
    assert.notEqual(next.refresh, first.refresh);
    assert.equal((await call('/users/me', next.token)).status, 200);
  });

  test('a refresh token works once; a quick second use (two tabs) fails without revoking', async () => {
    const first = await register('Tabs', 'tabs@example.com');
    const next = await refreshSession(first.refresh);
    assert.equal((await refreshSession(first.refresh)).status, 401);
    assert.equal((await refreshSession(next.refresh!)).status, 200, 'the rotated session still works');
  });

  test('reusing an old refresh token revokes every session of that user', async () => {
    const stolen = await register('Victim', 'refresh-victim@example.com');
    const next = await refreshSession(stolen.refresh);
    // pretend the rotation happened a while ago, so this is a replay and not the two-tab race
    await RefreshToken.updateOne(
      { tokenHash: hash(stolen.refresh) },
      { usedAt: new Date(Date.now() - REUSE_GRACE_MS - 1000) },
    );

    assert.equal((await refreshSession(stolen.refresh)).status, 401);
    assert.equal((await refreshSession(next.refresh!)).status, 401, 'the legitimate session is revoked too');
    assert.equal(await RefreshToken.countDocuments({ user: stolen.id }), 0);
  });

  test('a password change invalidates older refresh tokens', async () => {
    const session = await register('Changer', 'changer@example.com');
    const user = await User.findById(session.id);
    user!.password = 'a-brand-new-password';
    await user!.save();
    assert.equal((await refreshSession(session.refresh)).status, 401);
  });

  test('missing or unknown refresh tokens get 401 and cleared cookies', async () => {
    assert.equal((await call('/auth/refresh', undefined, 'POST')).status, 401);
    const unknown = await refreshSession('not-a-real-token');
    assert.equal(unknown.status, 401);
    assert.match(unknown.refreshCookie!, /Expires=Thu, 01 Jan 1970/);
  });
});

describe('notes', () => {
  test('users only see and change their own notes', async () => {
    const owner = await register('Owner', 'owner@example.com');
    const other = await register('Other', 'other@example.com');
    const { data: note } = await call('/notes', owner.token, 'POST', { title: 'Secret', content: 'x' });

    assert.equal((await call(`/notes/${note._id}`, other.token)).status, 404);
    assert.equal((await call(`/notes/${note._id}`, other.token, 'PATCH', { title: 'hacked' })).status, 404);
    assert.equal((await call(`/notes/${note._id}`, other.token, 'DELETE')).status, 404);
    assert.equal((await call('/notes', other.token)).data.total, 0);

    const updated = await call(`/notes/${note._id}`, owner.token, 'PATCH', { content: '' });
    assert.equal(updated.data.content, '');
    assert.equal(updated.data.title, 'Secret');
    assert.equal((await call(`/notes/${note._id}`, owner.token, 'PATCH', { title: '' })).status, 400);
    assert.equal((await call(`/notes/${note._id}`, owner.token, 'DELETE')).status, 204);
  });

  test('lists are paginated newest first', async () => {
    const { token } = await register('Pager', 'pager@example.com');
    for (const title of ['one', 'two', 'three']) await call('/notes', token, 'POST', { title });

    const { data } = await call('/notes?page=1&limit=2', token);
    assert.deepEqual(
      data.items.map((n: { title: string }) => n.title),
      ['three', 'two'],
    );
    assert.equal(data.total, 3);
    assert.equal(data.totalPages, 2);
    assert.equal((await call('/notes?page=99999999999999999999', token)).status, 200);
  });

  test('a bad id is a 400, not a 500', async () => {
    const { token } = await register('Bad', 'bad@example.com');
    assert.equal((await call('/notes/not-an-id', token)).status, 400);
  });
});

describe('admin', () => {
  test('admin-only routes are closed to users', async () => {
    const { token } = await register('Plain', 'plain@example.com');
    assert.equal((await call('/users', token)).status, 403);
    assert.equal((await call('/notes/all', token)).status, 403);
  });

  test('admin manages users and sees all notes', async () => {
    const admin = await register('Boss', 'boss@example.com');
    await User.updateOne({ _id: admin.id }, { role: 'admin' });
    const victim = await register('Gone', 'gone@example.com');
    await call('/notes', victim.token, 'POST', { title: 'bye' });
    await call('/posts', victim.token, 'POST', { title: 'bye', body: 'post' });

    const all = await call('/notes/all', admin.token);
    assert.ok(all.data.items.some((n: { owner: { name: string } }) => n.owner.name === 'Gone'));

    assert.equal((await call(`/users/${admin.id}`, admin.token, 'DELETE')).status, 400);
    assert.equal((await call(`/users/${admin.id}`, admin.token, 'PATCH', { role: 'user' })).status, 400);

    // token times have 1-second precision, so make sure the change lands in a later second
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await call(`/users/${victim.id}`, admin.token, 'PATCH', { password: 'brand-new-pass' });
    assert.equal((await call('/users/me', victim.token)).status, 401, 'password change ends old sessions');
    const login = await call('/auth/login', undefined, 'POST', {
      email: 'gone@example.com',
      password: 'brand-new-pass',
    });
    assert.equal(login.status, 200);

    assert.equal((await call(`/users/${victim.id}`, admin.token, 'DELETE')).status, 204);
    assert.equal((await call('/users/me', victim.token)).status, 401);
    assert.equal(await Note.countDocuments({ owner: victim.id }), 0);
    assert.equal(await Post.countDocuments({ author: victim.id }), 0);
    assert.equal(await RefreshToken.countDocuments({ user: victim.id }), 0);
  });
});

describe('aggregations', () => {
  test('users grouped by interest', async () => {
    const a = await register('Chess A', 'chess-a@example.com');
    const b = await register('Chess B', 'chess-b@example.com');
    await call('/users/me', a.token, 'PATCH', { interests: ['Chess', ' zz-reading', 'chess'] });
    await call('/users/me', b.token, 'PATCH', { interests: ['chess'] });

    const { data } = await call('/users/by-interest?limit=100', a.token);
    const chess = data.items.find((g: { interest: string }) => g.interest === 'chess');
    assert.equal(chess.count, 2);
    assert.equal(data.items.find((g: { interest: string }) => g.interest === 'zz-reading').count, 1);
  });

  test('posts of a user via $lookup, paginated', async () => {
    const author = await register('Writer', 'writer@example.com');
    for (const title of ['p1', 'p2', 'p3']) await call('/posts', author.token, 'POST', { title, body: 'b' });

    const { data } = await call(`/users/${author.id}/posts?limit=2`, author.token);
    assert.equal(data.user.name, 'Writer');
    assert.equal(data.total, 3);
    assert.deepEqual(
      data.items.map((p: { title: string }) => p.title),
      ['p3', 'p2'],
    );
    assert.equal((await call('/users/aaaaaaaaaaaaaaaaaaaaaaaa/posts', author.token)).status, 404);
  });
});

describe('indexes', () => {
  test('only the planned indexes exist', async () => {
    const names = async (model: { collection: { indexInformation(): Promise<object> } }) =>
      Object.keys(await model.collection.indexInformation()).sort();
    assert.deepEqual(await names(User), ['_id_', 'email_1', 'interests_1']);
    assert.deepEqual(await names(Note), ['_id_', 'owner_1__id_-1']);
    assert.deepEqual(await names(Post), ['_id_', 'author_1__id_-1']);
    assert.deepEqual(await names(RefreshToken), ['_id_', 'expiresAt_1', 'tokenHash_1', 'user_1']);
  });

  test('list and aggregation queries use an index, not a collection scan', async () => {
    const owner = new mongoose.Types.ObjectId();
    const plans = [
      await User.find({ email: 'ann@example.com' }).explain(),
      await Note.find({ owner }).sort({ _id: -1 }).limit(10).explain(),
      await User.aggregate([{ $match: { interests: { $gt: '' } } }]).explain(),
      await Post.find({ author: owner }).sort({ _id: -1 }).limit(10).explain(),
    ];
    for (const plan of plans) {
      const text = JSON.stringify(plan);
      assert.match(text, /IXSCAN/);
      assert.doesNotMatch(text, /COLLSCAN/);
    }
  });
});

describe('demo admin', () => {
  const demo = { email: 'demo.admin@example.com', password: 'demo-admin-password' };
  const login = () => call('/auth/login', undefined, 'POST', demo);

  test('is created on first run and can log in as admin', async () => {
    assert.equal(await ensureDemoAdmin(demo), 'created');
    const res = await login();
    assert.equal(res.status, 200);
    assert.equal(res.data.user.role, 'admin');
  });

  test('is left alone when nothing changed', async () => {
    assert.equal(await ensureDemoAdmin(demo), 'unchanged');
  });

  test('gets its role and password back if a reviewer changed them', async () => {
    const user = await User.findOne({ email: demo.email });
    user!.role = 'user';
    user!.password = 'someone-changed-it';
    await user!.save();
    assert.equal((await login()).status, 401);

    assert.equal(await ensureDemoAdmin(demo), 'restored');
    const res = await login();
    assert.equal(res.status, 200);
    assert.equal(res.data.user.role, 'admin');
  });
});

describe('config', () => {
  const valid = { MONGO_URI: 'mongodb://localhost/x', JWT_SECRET: 'x'.repeat(32) };

  test('defaults fill in optional variables', () => {
    const config = parseEnv(valid);
    assert.equal(config.port, 4000);
    assert.equal(config.accessTokenExpiresIn, '15m');
    assert.equal(config.refreshTokenDays, 7);
  });

  test('a bad value stops startup with a message naming the variable', () => {
    assert.throws(() => parseEnv({ ...valid, REFRESH_TOKEN_DAYS: '7d' }), /REFRESH_TOKEN_DAYS/);
    assert.throws(() => parseEnv({ ...valid, ACCESS_TOKEN_EXPIRES_IN: '15 minutes' }), /ACCESS_TOKEN_EXPIRES_IN/);
    assert.throws(() => parseEnv({ ...valid, JWT_SECRET: 'short' }), /JWT_SECRET must be at least 32/);
    assert.throws(() => parseEnv({ ...valid, LOG_LEVEL: 'verbose' }), /LOG_LEVEL/);
    assert.throws(() => parseEnv({ JWT_SECRET: valid.JWT_SECRET }), /MONGO_URI/);
    assert.throws(() => parseEnv({ ...valid, DEMO_ADMIN_EMAIL: 'demo@example.com' }), /both DEMO_ADMIN_EMAIL/);
    assert.equal(parseEnv(valid).demoAdmin, undefined, 'demo admin is off unless configured');
  });
});

// Last, because it uses up the login limit for this process.
describe('rate limiting', () => {
  test('repeated failed logins get 429', async () => {
    let status = 0;
    for (let i = 0; i < 12; i++) {
      status = (await call('/auth/login', undefined, 'POST', { email: 'ann@example.com', password: 'wrong-pass' }))
        .status;
    }
    assert.equal(status, 429);
  });
});
