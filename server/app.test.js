import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createApp } from './app.js';
import { createMockModel, createModel } from './model.js';
import { openStore } from './store.js';
import { shiftItems, relocate, segments, paragraphRanges, similarTurns } from '../shared/text.js';

function client(app, base = 'http://localhost') {
  return async function call(method, path, cookie, data) {
    const response = await app.handle(new Request(base + (path.startsWith('/api') ? path : '/api/v1' + path), {
      method,
      headers: { Cookie: cookie || '', 'Content-Type': 'application/json', ...(base !== 'http://localhost' ? { Origin: base } : {}) },
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(data ?? {}),
    }));
    const type = response.headers.get('content-type') ?? '';
    return {
      status: response.status, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0],
      body: response.status === 204 ? null : type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()),
    };
  };
}
async function login(call, username, password = 'munyeon-' + username) {
  const result = await call('POST', '/api/login', null, { username, password });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.cookie;
}
function temp(name) {
  const folder = mkdtempSync(join(tmpdir(), 'munyeon-' + name + '-'));
  return { folder, database: join(folder, name + '.sqlite'), done: () => rmSync(folder, { recursive: true, force: true }) };
}

test('anchors follow edits, relocate by quote, and split overlapping highlights', () => {
  const before = '첫 문단입니다.\n\n둘째 문단의 핵심 문장입니다.';
  const quote = '핵심 문장';
  const start = before.indexOf(quote);
  const items = [{ id: 'a', start, end: start + quote.length, quote }];
  const after = '앞에 새 문장을 넣었습니다. ' + before;
  const [shifted] = shiftItems(items, before, after);
  assert.equal(after.slice(shifted.start, shifted.end), quote);
  const [lost] = shiftItems(items, before, before.replace(quote, ''));
  assert.equal(lost.status, 'lost');
  assert.equal(relocate({ ...items[0], start: 0, end: 5 }, after).start, after.indexOf(quote));
  assert.equal(relocate({ ...items[0], quote: '없는 문장' }, after).status, 'lost');
  assert.deepEqual(paragraphRanges(before).map(range => range.text), ['첫 문단입니다.', '둘째 문단의 핵심 문장입니다.']);
  const parts = segments('abcdef', [{ id: 1, start: 0, end: 4 }, { id: 2, start: 2, end: 6 }]);
  assert.deepEqual(parts.map(part => [part.text, part.items.map(item => item.id)]), [['ab', [1]], ['cd', [1, 2]], ['ef', [2]]]);
  const turn = { id: 9, reply: '두 화면에서 같은 과제를 수행하게 하고 걸린 시간을 비교해 보세요.' };
  assert.equal(similarTurns('두 화면에서 같은 과제를 수행하게 하고 걸린 시간을 비교한다.', [turn]).length, 1);
  assert.equal(similarTurns('전혀 다른 주제의 문단으로 관찰 결과를 정리했다.', [turn]).length, 0);
});

test('runs the course workflow from publishing to oral questions with course isolation', async () => {
  const { database, done } = temp('workflow');
  let app = createApp({ database, model: createMockModel() });
  let call = client(app);
  try {
    const teacher = await login(call, 'teacher');
    const otherTeacher = await login(call, 'teacher2');
    const student = await login(call, 'student');
    const student3 = await login(call, 'student3');
    assert.equal((await call('GET', '/courses')).status, 401);

    // 교수자: 과목 → 분반 → 과제
    const courses = (await call('GET', '/courses', teacher)).body.items;
    assert.equal(courses.length, 1);
    assert.deepEqual(courses[0].sections.map(section => section.name), ['01분반', '02분반']);
    assert.equal((await call('GET', '/courses', otherTeacher)).body.items[0].name, '디자인 리서치 방법');
    const courseId = courses[0].id;
    assert.equal((await call('GET', '/courses/' + courseId, otherTeacher)).status, 404);
    const [first, second] = courses[0].sections;
    const listed = (await call('GET', `/courses/${courseId}/assignments?sectionId=${first.id}`, teacher)).body.items;
    assert.equal(listed[0].submitted, 2);
    assert.equal(listed[0].total, 2);

    // 새 과제: 구상은 허용, 문장 대신 작성은 제한. 01분반만 대상.
    const created = await call('POST', `/courses/${courseId}/assignments`, teacher, { title: '두 번째 과제', sectionIds: [first.id] });
    assert.equal(created.status, 200);
    const assignmentId = created.body.id;
    assert.equal((await call('GET', '/assignments/' + assignmentId, student)).status, 404, '공개 전에는 학생에게 보이지 않는다');
    const deadlineAt = new Date(Date.now() + 86400_000).toISOString();
    const patched = await call('PATCH', '/assignments/' + assignmentId, teacher, {
      revision: created.body.revision, instructions: '관찰 기록을 바탕으로 문제를 정의한다.', deadlineAt,
      stages: { s1: '구상', s2: '조사', s3: '작성', s4: '점검' },
    });
    assert.equal(patched.status, 200);
    assert.equal((await call('PATCH', '/assignments/' + assignmentId, teacher, { revision: created.body.revision, title: '옛 버전' })).status, 409);
    assert.equal((await call('POST', `/assignments/${assignmentId}/status`, teacher, { status: 'published' })).status, 200);
    assert.equal((await call('POST', `/assignments/${assignmentId}/status`, otherTeacher, { status: 'closed' })).status, 404);

    const view = (await call('GET', '/assignments/' + assignmentId, student)).body;
    assert.equal(view.stages.s2, '조사');
    assert.equal(view.rules.s1.write, 'restricted');
    assert.equal((await call('GET', '/assignments/' + assignmentId, student3)).status, 404, '다른 분반 학생은 접근할 수 없다');
    assert.equal((await call('GET', '/my/assignments', student)).body.items.length, 3, '두 과목의 과제가 모두 보인다');

    // 공개 후 과목 설정을 바꿔도 공개된 기준은 바로 바뀌지 않는다
    await call('PATCH', '/courses/' + courseId, teacher, { instructions: '새 지침' });
    const course = (await call('GET', '/courses/' + courseId, teacher)).body;
    assert.equal(course.instructions, '새 지침');

    // 채팅: 제한된 요청은 모델 없이 안내, 기준 확인 항목 생성
    const chat = (data) => call('POST', `/assignments/${assignmentId}/chat`, student, data);
    const restricted = await chat({ clientRequestId: 'r1', stage: 's3', activity: 'write', text: '결론 문단을 써 줘' });
    assert.equal(restricted.body.action, 'restricted');
    assert.equal(restricted.body.matchType, 'explicit_restriction');
    assert.equal((await chat({ clientRequestId: 'r1', stage: 's3', activity: 'write', text: '결론 문단을 써 줘' })).body.id, restricted.body.id, '같은 요청은 한 번만 저장');
    const hinted = await chat({ clientRequestId: 'r2', stage: 's1', activity: 'ideas', text: '문제 정의 문단을 대신 써 줘' });
    assert.equal(hinted.body.matchType, 'possible_match');
    const answered = await chat({ clientRequestId: 'r3', stage: 's1', activity: 'ideas', text: '관찰한 불편을 어떻게 고를까?' });
    assert.equal(answered.body.action, 'answered');
    assert.equal((await call('GET', `/assignments/${assignmentId}/chat`, student3)).status, 404);

    // 초안: 대화 두 건을 한 문장에 연결, 미반영 항목 추가
    const body = '문제 정의: 강의실 콘센트가 부족하다.\n\n해결 제안: 좌석 배치를 바꾼다.';
    const quote = '좌석 배치를 바꾼다.';
    const items = [
      { id: 'i1', start: body.indexOf(quote), end: body.indexOf(quote) + quote.length, quote, turnIds: [hinted.body.id, answered.body.id], stage: 's1', usage: 'reworked', explanation: '' },
      { id: 'i2', start: null, end: null, quote: '', turnIds: [answered.body.id], stage: 's1', usage: 'not_adopted', explanation: '관찰과 맞지 않아 넣지 않았다.' },
    ];
    const draftPath = `/assignments/${assignmentId}/draft`;
    let draft = await call('PUT', draftPath, student, { revision: 0, title: '콘센트 보고서', body, items, objections: [] });
    assert.equal(draft.status, 200);
    assert.equal(draft.body.revision, 1);
    assert.equal((await call('PUT', draftPath, student, { revision: 0, title: 'x', body, items: [], objections: [] })).status, 409);
    assert.equal((await call('PUT', draftPath, student, { revision: 1, title: 'x', body, items: [{ ...items[0], turnIds: [999] }], objections: [] })).status, 400);
    let submit = await call('POST', `/assignments/${assignmentId}/submission`, student, { clientRequestId: 's1', revision: 1 });
    assert.equal(submit.body.code, 'REPORT_INCOMPLETE', '설명이 빈 항목이 있으면 제출할 수 없다');

    // 본문이 바뀌어 원문을 찾지 못하면 위치 확인 필요
    const moved = await call('PUT', draftPath, student, { revision: 1, title: '콘센트 보고서', body: body.replace(quote, '책상을 옮긴다.'), items, objections: [] });
    assert.equal(moved.body.items[0].status, 'lost');
    items[0].explanation = '두 대화를 참고해 배치 변경으로 바꿨다.';
    draft = await call('PUT', draftPath, student, { revision: 2, title: '콘센트 보고서', body, items, objections: [] });
    assert.equal(draft.body.items[0].status, 'ok');

    // 파일 업로드(.txt) 후 원본 보관
    const imported = await call('POST', draftPath + '/import', student, { fileName: '보고서.txt', data: Buffer.from(body).toString('base64') });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.text, body);
    assert.equal((await call('POST', draftPath + '/import', student, { fileName: '보고서.hwp', data: 'AAAA' })).status, 422);
    draft = await call('PUT', draftPath, student, { revision: 3, title: '콘센트 보고서', body, items, objections: [], fileId: imported.body.file.id });
    assert.equal(draft.body.file.name, '보고서.txt');
    assert.equal(draft.body.editedAfterUpload, false);

    submit = await call('POST', `/assignments/${assignmentId}/submission`, student, { clientRequestId: 's2', revision: 4 });
    assert.equal(submit.status, 200, JSON.stringify(submit.body));
    assert.equal(submit.body.submission.version.no, 1);
    assert.equal((await call('POST', `/assignments/${assignmentId}/submission`, student, { clientRequestId: 's2', revision: 4 })).body.submission.versions.length, 1, '중복 제출은 한 건');

    // 마감 전 재제출
    draft = await call('PUT', draftPath, student, { revision: 4, title: '콘센트 보고서(수정)', body: body + '\n\n한계: 공사 비용이 든다.', items, objections: [], fileId: imported.body.file.id });
    assert.equal(draft.body.editedAfterUpload, true);
    submit = await call('POST', `/assignments/${assignmentId}/submission`, student, { clientRequestId: 's3', revision: 5 });
    assert.equal(submit.body.submission.version.no, 2);
    assert.equal((await call('POST', `/assignments/${assignmentId}/submission`, student, { clientRequestId: 's3', revision: 5 })).body.submission.versions.length, 2);

    // 교수자 검토: 제출 이력, 근거, 기준 확인 항목, 원본 파일
    const roster = (await call('GET', `/assignments/${assignmentId}/roster`, teacher)).body.items;
    const row = roster.find(item => item.submissionId);
    assert.equal(row.versionNo, 2);
    assert.equal(row.pendingEvents, 2);
    assert.equal(roster.length, 2, '대상 분반(01분반) 학생만');
    const path = '/submissions/' + row.submissionId;
    assert.equal((await call('GET', path, otherTeacher)).status, 404, '다른 교수자는 열람할 수 없다');
    const detail = (await call('GET', path, teacher)).body;
    assert.equal(detail.version.no, 2);
    assert.equal(detail.version.editedAfterUpload, true);
    assert.equal(detail.version.items[0].turns.length, 2);
    assert.equal(detail.version.items[0].paragraph, 1);
    assert.equal(detail.version.items[1].paragraph, null);
    assert.equal(detail.policyEvents.length, 2);
    assert.equal(detail.policyEvents[0].rule, 'restricted');
    assert.equal((await call('GET', path + '?no=1', teacher)).body.version.title, '콘센트 보고서');
    const file = await call('GET', '/files/' + detail.version.file.id, teacher);
    assert.equal(file.body.toString(), body);
    assert.match(file.headers.get('content-disposition'), /filename\*=UTF-8''/);
    assert.equal((await call('GET', '/files/' + detail.version.file.id, otherTeacher)).status, 404);
    assert.equal((await call('GET', '/files/' + detail.version.file.id, student3)).status, 404);
    const event = detail.policyEvents[0];
    assert.equal((await call('PATCH', `${path}/policy-events/${event.id}`, teacher, { status: 'confirmed', memo: '확인함' })).body.policyEvents[0].status, 'confirmed');
    assert.equal((await call('PUT', path + '/flags', teacher, { target: 'item:i1', flagged: true, memo: '구술에서 확인' })).body.flags.length, 1);

    // 2차 질문: 추천 + 직접 작성 + 수정·선택, 새로고침 후 유지
    const suggested = await call('POST', path + '/questions/suggest', teacher);
    assert.equal(suggested.status, 200);
    assert.ok(suggested.body.questions.length >= 1);
    assert.ok(suggested.body.questions.every(question => question.source === 'ai_suggested' && !question.selected));
    const manual = await call('POST', path + '/questions', teacher, { text: '왜 배치 변경을 골랐나요?', anchor: { itemId: 'i1' } });
    const question = manual.body.questions.at(-1);
    assert.equal(question.anchor.quote, quote);
    assert.equal(question.selected, true);
    const edited = await call('PATCH', `${path}/questions/${suggested.body.questions[0].id}`, teacher, { text: '수정한 질문', selected: true });
    assert.equal(edited.body.questions[0].originalText, suggested.body.questions[0].text);
    assert.equal((await call('PUT', path + '/evaluation', teacher, { reason: 2, transfer: 1, memo: '근거를 설명함' })).status, 200);

    app.close();
    app = createApp({ database, model: createModel() });
    call = client(app);
    const reloaded = (await call('GET', path, teacher)).body;
    assert.equal(reloaded.questions[0].text, '수정한 질문');
    assert.equal(reloaded.evaluation.reason, 2);
    assert.equal((await call('GET', `/assignments/${assignmentId}/roster`, teacher)).body.items.find(item => item.submissionId).status, 'evaluated');
    assert.equal((await call('POST', path + '/questions/suggest', teacher)).body.code, 'AI_DISABLED', '모델이 꺼져도 직접 작성은 가능');
    assert.equal((await call('POST', `/assignments/${assignmentId}/chat`, student, { clientRequestId: 'x', stage: 's1', activity: 'ideas', text: '질문' })).body.code, 'AI_DISABLED');

    // 마감·조기 종료 후에는 초안과 제출을 막고 초안은 남긴다
    await call('POST', `/assignments/${assignmentId}/status`, teacher, { status: 'closed' });
    const late = await call('POST', `/assignments/${assignmentId}/submission`, student, { clientRequestId: 's4', revision: 5 });
    assert.equal(late.body.code, 'ASSIGNMENT_CLOSED');
    assert.equal((await call('GET', draftPath, student)).body.title, '콘센트 보고서(수정)');
    const expired = (await call('GET', '/courses/' + courseId + '/assignments', teacher)).body.items.find(item => item.id === assignmentId);
    await call('POST', `/assignments/${assignmentId}/status`, teacher, { status: 'published' });
    const current = (await call('GET', '/assignments/' + assignmentId, teacher)).body;
    await call('PATCH', '/assignments/' + assignmentId, teacher, { revision: current.revision, deadlineAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal(expired.status, 'closed');
    assert.equal((await call('PUT', draftPath, student, { revision: 5, title: 't', body: 'b', items: [], objections: [] })).body.code, 'DEADLINE_PASSED');

    // 수강 명단 관리
    const member = await call('POST', `/courses/${courseId}/members`, teacher, { username: 'student3', sectionId: first.id });
    assert.equal(member.body.members.find(item => item.username === 'student3').sectionId, first.id);
    assert.equal((await call('POST', `/courses/${courseId}/members`, teacher, { username: 'teacher2', sectionId: first.id })).status, 404);
    assert.equal((await call('POST', `/courses/${courseId}/members`, teacher, { username: 'student3', sectionId: 99999 })).status, 400);
    await call('DELETE', `/courses/${courseId}/members/${member.body.members.find(item => item.username === 'student3').studentId}`, teacher);
    assert.equal((await call('GET', '/my/assignments', student3)).body.items.length, 0);
    assert.ok(second.id);
  } finally {
    app.close();
    done();
  }
});

test('migrates a single-assignment database into the course structure', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { database, done } = temp('legacy');
  try {
    const db = new DatabaseSync(database);
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
      CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE assignment (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL);
      CREATE TABLE messages (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, mode TEXT NOT NULL, prompt TEXT NOT NULL, reply TEXT NOT NULL);
      CREATE TABLE submissions (id INTEGER PRIMARY KEY, student_id INTEGER UNIQUE NOT NULL, title TEXT NOT NULL, paragraphs TEXT NOT NULL, evidence TEXT NOT NULL, modes TEXT NOT NULL, config TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE questions (id INTEGER PRIMARY KEY, submission_id INTEGER NOT NULL REFERENCES submissions(id), paragraph INTEGER NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE evaluations (submission_id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL, reason INTEGER, transfer INTEGER, memo TEXT NOT NULL DEFAULT '');
      CREATE TABLE drafts (student_id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, report TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    db.prepare("INSERT INTO users VALUES (1,'prof','교수','teacher','s','p'),(2,'kim','학생','student','s','p')").run();
    db.prepare('INSERT INTO assignment VALUES (1,?)').run(JSON.stringify({ title: '이전 과제', course: '이전 과목', section: '2분반', due: '2026-11-27T23:59', prompt: '안내', allowed: '개념 설명', restricted: '대필', rubric: '기준' }));
    db.prepare("INSERT INTO messages VALUES (1,2,'hint','질문','답변')").run();
    db.prepare('INSERT INTO submissions VALUES (1,2,?,?,?,?,?,?)').run('보고서', JSON.stringify(['첫 문단', '둘째 문단']),
      JSON.stringify({ mode: 'shared', paragraph: 1, explanation: '설명', question: '질문', excerpt: '답변' }), '[]', '{}', '2026-11-20T00:00:00.000Z');
    db.prepare("INSERT INTO questions VALUES (1,1,1,'왜 그렇게 판단했나요?','직접 작성')").run();
    db.prepare("INSERT INTO evaluations VALUES (1,1,2,1,'메모')").run();
    db.close();

    const store = openStore(database, { demo: false, allowDemoAccounts: true });
    const course = store.get('SELECT * FROM courses');
    assert.equal(course.name, '이전 과목');
    assert.equal(store.get('SELECT name FROM sections').name, '2분반');
    const assignment = store.get('SELECT * FROM assignments');
    assert.equal(assignment.status, 'published');
    assert.match(assignment.instructions, /제한하는 도움: 대필/);
    assert.equal(assignment.deadline_at, '2026-11-27T14:59:00.000Z');
    assert.equal(store.get('SELECT activity FROM chat_turns').activity, 'explain');
    const version = store.get('SELECT * FROM submission_versions');
    const [item] = JSON.parse(version.items);
    assert.equal(version.body.slice(item.start, item.end), '둘째 문단');
    assert.equal(item.turns[0].legacy, true);
    const question = store.get('SELECT * FROM questions');
    assert.equal(question.selected, 1);
    assert.equal(JSON.parse(question.anchor).quote, '둘째 문단');
    assert.equal(store.get('SELECT reason FROM evaluations').reason, 2);
    assert.ok(store.get("SELECT 1 FROM sqlite_master WHERE name='legacy_submissions'"), '이전 표는 남긴다');
    assert.equal(store.get('PRAGMA user_version').user_version, 2);
    store.db.close();
  } finally {
    done();
  }
});

test('protects the hosted instance and preserves accounts across backup and restore', async () => {
  const { folder, database, done } = temp('hosted');
  const origin = 'https://munyeon.example.org';
  const admin = (path, args, stdin) => {
    const result = spawnSync(process.execPath, ['server/admin.js', ...args], { env: { ...process.env, MUNYEON_DB: path }, input: stdin, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const password = 'Local-test-only-password-73';
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
    let call = client(app, origin);
    assert.equal(app.ready(), true);
    assert.equal((await call('GET', '/api/session')).body.demo, false);
    assert.equal((await call('GET', '/courses')).status, 401);
    assert.equal((await call('POST', '/api/login', null, { username: 'teacher', password: 'munyeon-teacher' })).status, 401);
    const teacher = await login(call, 'instructor', password);
    const student = await login(call, 'learner', password);
    const course = (await call('POST', '/courses', teacher, { name: '운영 과목', sections: ['01분반'] })).body;
    await call('POST', `/courses/${course.id}/members`, teacher, { username: 'learner', sectionId: course.sections[0].id });
    const assignment = (await call('POST', `/courses/${course.id}/assignments`, teacher, { title: '운영 과제', sectionIds: [course.sections[0].id] })).body;
    await call('POST', `/assignments/${assignment.id}/status`, teacher, { status: 'published' });
    assert.equal((await call('POST', `/assignments/${assignment.id}/chat`, student, { clientRequestId: 'a', stage: 's1', activity: 'ideas', text: '힌트' })).status, 200);
    assert.equal((await call('POST', `/assignments/${assignment.id}/chat`, student, { clientRequestId: 'b', stage: 's1', activity: 'ideas', text: '한도' })).status, 429);
    await call('PUT', `/assignments/${assignment.id}/draft`, student, { revision: 0, title: '보존할 과제', body: '근거 문단', items: [], objections: [], noAi: true });
    assert.equal((await call('POST', `/assignments/${assignment.id}/submission`, student, { clientRequestId: 'x', revision: 1 })).status, 200);
    for (let i = 0; i < 8; i++) assert.equal((await call('POST', '/api/login', null, { username: 'unknown', password })).status, 401);
    assert.equal((await call('POST', '/api/login', null, { username: 'unknown', password })).status, 429);
    const snapshot = join(folder, 'backup.sqlite');
    const restored = join(folder, 'restored.sqlite');
    admin(database, ['backup', snapshot]);
    admin(restored, ['restore'], readFileSync(snapshot));
    admin(database, ['reset-password', 'instructor'], 'Updated-test-password-01');
    assert.equal((await call('GET', '/courses', teacher)).status, 401);
    app.close();
    app = createApp({ database: restored, origin });
    call = client(app, origin);
    const again = await login(call, 'instructor', password);
    const roster = await call('GET', `/assignments/${assignment.id}/roster`, again);
    assert.equal(roster.body.items[0].status, 'submitted');
  } finally {
    app?.close();
    done();
  }
});
