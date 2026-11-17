// End-to-end tests against a real MongoDB. Uses its own database, which is dropped on every run.
// Run with: pnpm test   (override the database with TEST_MONGO_URI)
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

process.env.MONGO_URI = process.env.TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/secure-notes-test';
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';

const { default: mongoose } = await import('mongoose');
const { app } = await import('../src/app.js');
const { User } = await import('../src/models/User.js');
const { Note } = await import('../src/models/Note.js');
const { Post } = await import('../src/models/Post.js');

let server: Server;
let baseUrl: string;

// `token` is sent the way a browser would: as the auth cookie.
async function call(path: string, token?: string, method = 'GET', body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Cookie: `token=${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('token='));
  return {
    status: res.status,
    data: res.status === 204 ? null : await res.json(),
    headers: res.headers,
    setCookie,
    token: setCookie?.split(';')[0].slice('token='.length),
  };
}

async function register(name: string, email: string) {
  const res = await call('/auth/register', undefined, 'POST', { name, email, password: 'password123' });
  return { token: res.token!, id: res.data.user._id as string };
}

before(async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  await mongoose.connection.dropDatabase();
  await Promise.all([User.syncIndexes(), Note.syncIndexes(), Post.syncIndexes()]);
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

  test('the auth cookie is httpOnly and SameSite=Strict', async () => {
    const res = await call('/auth/login', undefined, 'POST', { email: 'ann@example.com', password: 'password123' });
    assert.match(res.setCookie!, /HttpOnly/);
    assert.match(res.setCookie!, /SameSite=Strict/);
  });

  test('tokens signed with another secret or algorithm are rejected', async () => {
    const { default: jwt } = await import('jsonwebtoken');
    const user = await User.findOne({ email: 'ann@example.com' });
    const forged = jwt.sign({ role: 'admin' }, 'some-other-secret', { subject: user!.id });
    assert.equal((await call('/users/me', forged)).status, 401);
    const unsigned = jwt.sign({ role: 'admin' }, '', { subject: user!.id, algorithm: 'none' });
    assert.equal((await call('/users/me', unsigned)).status, 401);
  });

  test('invalid input is rejected by the model', async () => {
    const bad = (body: object) =>
      call('/auth/register', undefined, 'POST', { name: 'X', password: 'password123', ...body });
    assert.equal((await bad({ email: 'not-an-email' })).status, 400);
    assert.equal((await bad({ email: 'long@example.com', password: 'a'.repeat(73) })).status, 400);
    const { token } = await register('Many', 'many@example.com');
    const tooMany = Array.from({ length: 21 }, (_, i) => `topic-${i}`);
    assert.equal((await call('/users/me', token, 'PATCH', { interests: tooMany })).status, 400);
  });

  test('logout clears the cookie', async () => {
    const res = await call('/auth/logout', undefined, 'POST');
    assert.equal(res.status, 204);
    assert.match(res.setCookie!, /Expires=Thu, 01 Jan 1970/);
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
    const names = async (model: typeof User | typeof Note | typeof Post) =>
      Object.keys(await model.collection.indexInformation()).sort();
    assert.deepEqual(await names(User), ['_id_', 'email_1', 'interests_1']);
    assert.deepEqual(await names(Note), ['_id_', 'owner_1__id_-1']);
    assert.deepEqual(await names(Post), ['_id_', 'author_1__id_-1']);
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
