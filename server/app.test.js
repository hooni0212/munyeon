import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from './app.js';
import { createModel } from './model.js';
import { defaults } from './store.js';

async function call(app, method, path, cookie, data = {}) {
  const response = await app.handle(new Request('http://localhost/api' + path, {
    method,
    headers: { Cookie: cookie || '', 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(data),
  }));
  return {
    status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0],
    body: response.status === 204 ? null : await response.json(),
  };
}

async function login(app, username) {
  const result = await call(app, 'POST', '/login', null, { username, password: 'munyeon-' + username });
  assert.equal(result.status, 200);
  return result.cookie;
}

test('persists an assignment from scoped tutoring to oral evaluation', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'munyeon-test-'));
  const database = join(folder, 'workflow.sqlite');
  const sent = [];
  const model = createModel({
    baseUrl: 'https://example.invalid/v1', model: 'integration-test', key: 'test-only',
    request: async (url, request) => {
      assert.equal(url.pathname, '/v1/chat/completions');
      assert.equal(request.headers.Authorization, 'Bearer test-only');
      const payload = JSON.parse(request.body);
      sent.push(payload);
      const content = payload.response_format
        ? JSON.stringify({ questions: [
          { paragraph: 1, text: '중앙값을 선택한 이유와 극단값을 뺄 때의 변화를 설명하세요.' },
          { paragraph: 9, text: '없는 근거' },
        ] })
        : '평균과 중앙값을 각각 구해 비교해 보세요.';
      return Response.json({ choices: [{ message: { content } }] });
    },
  });
  let app = createApp({ database, model });
  try {
    const teacher = await login(app, 'teacher');
    const student = await login(app, 'student');
    const other = await login(app, 'student2');
    assert.equal((await call(app, 'GET', '/assignment')).status, 401);
    assert.equal((await call(app, 'PUT', '/assignment', student, defaults)).status, 403);
    assert.equal((await call(app, 'GET', '/learning', teacher)).status, 403);
    const config = { ...defaults, goal: '표본의 극단값과 대표값을 비교한다.' };
    assert.deepEqual((await call(app, 'PUT', '/assignment', teacher, config)).body, config);
    const privateTurn = await call(app, 'POST', '/learning', student, { mode: 'concept', prompt: '교수자에게 공유하지 않을 질문' });
    const sharedTurn = await call(app, 'POST', '/learning', student, { mode: 'hint', prompt: '어떻게 비교할까요?' });
    assert.equal(privateTurn.status, 200);
    assert.equal(sharedTurn.status, 200);
    assert.ok(sent[0].messages[0].content.includes(config.goal));
    assert.equal(sent[1].messages.length, 4);
    assert.deepEqual((await call(app, 'GET', '/learning', other)).body, []);

    const report = { title: '대표값 보고서', text: '연구 개요\n\n중앙값을 선택했다.', explanation: '극단값을 고려했다.', paragraph: 1, messageId: sharedTurn.body.id };
    assert.equal((await call(app, 'POST', '/submission', other, report)).status, 400);
    const sentReport = await call(app, 'POST', '/submission', student, report);
    assert.equal(sentReport.status, 200);
    assert.equal((await call(app, 'POST', '/submission', student, report)).status, 409);
    assert.equal((await call(app, 'POST', '/submission', other, { title: '독립 작성', text: '본문' })).status, 200);
    const path = '/submissions/' + sentReport.body.submission.id;
    assert.equal((await call(app, 'GET', path, other)).status, 403);
    const review = await call(app, 'GET', path, teacher);
    assert.equal(review.body.evidence.excerpt, sharedTurn.body.reply);
    assert.ok(!JSON.stringify(review.body).includes('공유하지 않을 질문'));

    const suggested = await call(app, 'POST', path + '/suggest', teacher);
    assert.equal(suggested.status, 200);
    assert.equal(suggested.body.questions.length, 1);
    assert.equal(suggested.body.questions[0].paragraph, 1);
    assert.ok(!JSON.stringify(sent.at(-1)).includes('공유하지 않을 질문'));
    assert.equal((await call(app, 'POST', path + '/suggest', teacher)).body.questions.length, 1);
    const added = await call(app, 'POST', path + '/questions', teacher, { paragraph: 0, text: '직접 작성한 질문' });
    assert.equal(added.body.questions.length, 2);
    const { id, text } = added.body.questions[0];
    assert.equal((await call(app, 'PUT', path + '/confirm', teacher, { questionId: id })).status, 200);
    const score = { questionId: id, questionText: text, reason: 2, transfer: 1, memo: '근거를 설명함' };
    assert.equal((await call(app, 'PUT', path + '/evaluation', teacher, score)).body.evaluation.reason, 2);

    app.close();
    app = createApp({ database, model });
    assert.equal((await call(app, 'GET', path, teacher)).body.evaluation.memo, score.memo);
    const edited = await call(app, 'PATCH', path + '/questions/' + id, teacher, { text: '변경된 구술 질문' });
    assert.equal(edited.body.evaluation.reason, null);
    assert.equal((await call(app, 'PUT', path + '/evaluation', teacher, score)).status, 409);
    assert.equal((await call(app, 'POST', '/logout', teacher)).status, 204);
    assert.equal((await call(app, 'GET', path, teacher)).status, 401);
  } finally {
    app.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('reports an unconfigured provider without inventing a response', async () => {
  const app = createApp({ database: ':memory:' });
  try {
    const student = await login(app, 'student');
    const result = await call(app, 'POST', '/learning', student, { mode: 'hint', prompt: '힌트를 주세요.' });
    assert.equal(result.status, 503);
    assert.deepEqual((await call(app, 'GET', '/learning', student)).body, []);
  } finally {
    app.close();
  }
});

test('protects the hosted instance and preserves accounts across backup and restore', async () => {
  const { openStore } = await import('./store.js');
  const { spawnSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const folder = mkdtempSync(join(tmpdir(), 'munyeon-hosted-'));
  const database = join(folder, 'hosted.sqlite');
  const origin = 'https://munyeon.example.org';
  const admin = (path, args, stdin) => {
    const result = spawnSync(process.execPath, ['server/admin.js', ...args], {
      env: { ...process.env, MUNYEON_DB: path }, input: stdin, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  };
  const password = 'Local-test-only-password-73';
  const credentials = { username: 'instructor', password };
  let app;
  try {
    const local = openStore(join(folder, 'demo.sqlite'));
    local.db.close();
    assert.throws(() => createApp({ database: join(folder, 'demo.sqlite'), origin }), /체험 계정/);
    admin(database, ['create-user', 'instructor', 'teacher', '운영 교수자'], password);
    admin(database, ['create-user', 'learner', 'student', '운영 학생'], password);
    app = createApp({ database, origin, aiDailyLimit: 1, model: createModel({
      baseUrl: 'https://api.openai.com/v1', model: 'test-model',
      request: async (_url, request) => {
        assert.equal(JSON.parse(request.body).max_completion_tokens, 1600);
        return Response.json({ choices: [{ message: { content: '근거를 찾아보세요.' } }] });
      },
    }) });
    function hosted(method, path, body, session, requestOrigin = origin, ip = '192.0.2.1') {
      return app.handle(new Request(origin + '/api' + path, {
        method, headers: { Origin: requestOrigin, Cookie: session || '', 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(body),
      }), { ip });
    }
    assert.equal(app.ready(), true);
    assert.equal((await (await hosted('GET', '/session')).json()).demo, false);
    assert.equal((await hosted('POST', '/login', credentials, null, 'https://other.example.org')).status, 403);
    assert.equal((await hosted('POST', '/login', { username: 'teacher', password: 'munyeon-teacher' })).status, 401);
    const login = await hosted('POST', '/login', credentials);
    assert.equal(login.status, 200);
    const session = login.headers.get('set-cookie');
    assert.match(session, /^__Host-munyeon=/);
    assert.match(session, /; Secure/);
    const student = await hosted('POST', '/login', { username: 'learner', password });
    const studentCookie = student.headers.get('set-cookie');
    assert.equal((await hosted('POST', '/learning', { mode: 'hint', prompt: '힌트' }, studentCookie)).status, 200);
    assert.equal((await hosted('POST', '/learning', { mode: 'hint', prompt: '한도' }, studentCookie)).status, 429);
    const submission = await hosted('POST', '/submission', { title: '보존할 과제', text: '근거 문단' }, studentCookie);
    assert.equal(submission.status, 200);
    for (let i = 0; i < 8; i++) {
      assert.equal((await hosted('POST', '/login', { username: 'unknown', password })).status, 401);
    }
    assert.equal((await hosted('POST', '/login', { username: 'unknown', password })).status, 429);
    const snapshot = join(folder, 'backup.sqlite');
    const restored = join(folder, 'restored.sqlite');
    admin(database, ['backup', snapshot]);
    admin(restored, ['restore'], readFileSync(snapshot));
    admin(database, ['reset-password', 'instructor'], 'Updated-test-password-01');
    assert.equal((await hosted('GET', '/submissions', null, session)).status, 401);
    app.close();
    app = createApp({ database: restored, origin });
    assert.equal((await hosted('GET', '/submissions', null, session)).status, 401);
    const reauthenticated = await hosted('POST', '/login', credentials);
    assert.equal(reauthenticated.status, 200);
    const submissions = await hosted('GET', '/submissions', null, reauthenticated.headers.get('set-cookie'));
    assert.equal((await submissions.json())[0].title, '보존할 과제');
  } finally {
    app?.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
