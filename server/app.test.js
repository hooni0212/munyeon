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
    const config = { ...defaults, prompt: '표본의 극단값과 대표값을 비교한다.', due: '2026-11-27T23:59' };
    assert.deepEqual((await call(app, 'PUT', '/assignment', teacher, config)).body, config);
    assert.equal((await call(app, 'PUT', '/assignment', teacher, { ...config, due: '다음 주' })).status, 400);
    const privateTurn = await call(app, 'POST', '/learning', student, { mode: 'concept', prompt: '교수자에게 공유하지 않을 질문' });
    const sharedTurn = await call(app, 'POST', '/learning', student, { mode: 'hint', prompt: '어떻게 비교할까요?' });
    assert.equal(privateTurn.status, 200);
    assert.equal(sharedTurn.status, 200);
    assert.ok(sent[0].messages[0].content.includes(config.prompt));
    assert.equal(sent[1].messages.length, 4);
    assert.deepEqual((await call(app, 'GET', '/learning', other)).body, []);

    const draft = { title: '대표값 보고서', body: '연구 개요\n\n중앙값을 선택했다.', report: { mode: 'shared', messageId: sharedTurn.body.id, paragraph: 1, explanation: '극단값을 고려했다.' } };
    assert.equal((await call(app, 'PUT', '/draft', teacher, draft)).status, 403);
    assert.equal((await call(app, 'PUT', '/draft', student, { ...draft, report: { mode: 'copied' } })).status, 400);
    assert.equal((await call(app, 'PUT', '/draft', student, draft)).status, 200);
    assert.equal((await call(app, 'GET', '/draft', student)).body.body, draft.body);
    assert.equal((await call(app, 'GET', '/draft', other)).body.body, '');

    const report = { title: draft.title, text: draft.body, report: draft.report };
    assert.equal((await call(app, 'POST', '/submission', student, { ...report, report: {} })).status, 400);
    assert.equal((await call(app, 'POST', '/submission', other, report)).status, 400);
    const sentReport = await call(app, 'POST', '/submission', student, report);
    assert.equal(sentReport.status, 200);
    assert.deepEqual(sentReport.body.submission.paragraphs, ['연구 개요', '중앙값을 선택했다.']);
    assert.equal((await call(app, 'POST', '/submission', student, report)).status, 409);
    assert.equal((await call(app, 'GET', '/draft', student)).body.body, '');
    assert.equal((await call(app, 'PUT', '/draft', student, draft)).status, 409);
    assert.equal((await call(app, 'POST', '/submission', other, { title: '독립 작성', text: '본문', report: { mode: 'none' } })).status, 200);
    const path = '/submissions/' + sentReport.body.submission.id;
    assert.equal((await call(app, 'GET', path, other)).status, 403);
    assert.equal((await call(app, 'GET', '/roster', other)).status, 403);
    assert.deepEqual((await call(app, 'GET', '/roster', teacher)).body.map(row => row.status), ['검토 대기', '검토 대기']);
    const review = await call(app, 'GET', path, teacher);
    assert.equal(review.body.evidence.mode, 'shared');
    assert.equal(review.body.evidence.excerpt, sharedTurn.body.reply);
    assert.equal(review.body.evidence.question, sharedTurn.body.prompt);
    assert.ok(!JSON.stringify(review.body).includes('공유하지 않을 질문'));

    const suggested = await call(app, 'POST', path + '/suggest', teacher);
    assert.equal(suggested.status, 200);
    assert.equal(suggested.body.questions.length, 1);
    assert.equal(suggested.body.questions[0].paragraph, 1);
    assert.ok(!JSON.stringify(sent.at(-1)).includes('공유하지 않을 질문'));
    assert.equal((await call(app, 'POST', path + '/suggest', teacher)).body.questions.length, 1);
    assert.equal((await call(app, 'PUT', path + '/question', teacher, { paragraph: 5, text: '없는 문단' })).status, 400);
    const saved = await call(app, 'PUT', path + '/question', teacher, { paragraph: 0, text: '직접 작성한 질문' });
    const id = saved.body.evaluation.questionId;
    const text = saved.body.questions.find(item => item.id === id).text;
    assert.equal(text, '직접 작성한 질문');
    assert.equal((await call(app, 'GET', '/roster', teacher)).body[0].status, '질문 준비 완료');
    const score = { questionId: id, questionText: text, reason: 2, transfer: 1, memo: '근거를 설명함' };
    assert.equal((await call(app, 'PUT', path + '/evaluation', teacher, score)).body.evaluation.reason, 2);

    app.close();
    app = createApp({ database, model });
    assert.equal((await call(app, 'GET', path, teacher)).body.evaluation.memo, score.memo);
    assert.equal((await call(app, 'GET', '/roster', teacher)).body[0].status, '평가 완료');
    const unchanged = await call(app, 'PUT', path + '/question', teacher, { paragraph: 0, text: '직접 작성한 질문' });
    assert.equal(unchanged.body.evaluation.reason, 2);
    const edited = await call(app, 'PUT', path + '/question', teacher, { paragraph: 1, text: '변경된 구술 질문' });
    assert.equal(edited.body.evaluation.questionId, id);
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
    const submission = await hosted('POST', '/submission', { title: '보존할 과제', text: '근거 문단', report: { mode: 'none' } }, studentCookie);
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
    assert.equal((await hosted('GET', '/roster', null, session)).status, 401);
    app.close();
    app = createApp({ database: restored, origin });
    assert.equal((await hosted('GET', '/roster', null, session)).status, 401);
    const reauthenticated = await hosted('POST', '/login', credentials);
    assert.equal(reauthenticated.status, 200);
    const roster = await hosted('GET', '/roster', null, reauthenticated.headers.get('set-cookie'));
    assert.equal((await roster.json())[0].title, '보존할 과제');
  } finally {
    app?.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('moves settings and evidence saved by the previous screens into the current format', async () => {
  const { openStore, normalizeEvidence } = await import('./store.js');
  const folder = mkdtempSync(join(tmpdir(), 'munyeon-legacy-'));
  const database = join(folder, 'legacy.sqlite');
  try {
    const legacy = openStore(database);
    legacy.run('UPDATE assignment SET config=? WHERE id=1', JSON.stringify({
      title: '이전 과제', course: '이전 과목', goal: '목표', materials: '자료', help: '개념 설명', independent: '최종 해석', rubric: '기준',
    }));
    legacy.db.close();
    const store = openStore(database);
    const config = store.assignment();
    assert.equal(config.title, '이전 과제');
    assert.equal(config.prompt, '목표\n참고 자료: 자료');
    assert.equal(config.allowed, '개념 설명');
    assert.equal(config.restricted, '직접 할 부분: 최종 해석');
    assert.equal(JSON.parse(store.get('SELECT config FROM assignment WHERE id=1').config).prompt, config.prompt);
    store.db.close();
    assert.deepEqual(normalizeEvidence(null), { mode: 'unreported' });
    assert.equal(normalizeEvidence({ paragraph: 0, explanation: '설명', excerpt: '', source: '학생 자기보고' }).mode, 'manual');
    assert.equal(normalizeEvidence({ paragraph: 1, explanation: '설명', excerpt: '답변', source: '문연 학습실' }).paragraph, 1);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
