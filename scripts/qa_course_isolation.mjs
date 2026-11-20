// Diagnostic only: use synthetic in-memory data; never connect to school Canvas.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openStore, defaults } from '../server/store.js';
import { createApp } from '../server/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const folder = mkdtempSync(join(tmpdir(), 'munyeon-course-qa-'));
const database = join(folder, 'fixture.sqlite');
const password = randomBytes(24).toString('base64url');
const seed = openStore(database, { demo: false });
for (const [username, role] of [['qa-instructor-a', 'teacher'], ['qa-instructor-b', 'teacher'], ['qa-student', 'student']]) {
  seed.createAccount({ username, role, name: username, password });
}
seed.db.close();
const app = createApp({ database, origin: 'https://qa.invalid' });
async function call(method, path, cookie, data) {
  const r = await app.handle(new Request('https://qa.invalid/api' + path, {
    method, headers: { Origin: 'https://qa.invalid', Cookie: cookie || '', 'Content-Type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {}),
  }));
  return { status: r.status, body: r.status === 204 ? null : await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
try {
  const a = await call('POST', '/login', null, { username: 'qa-instructor-a', password });
  const b = await call('POST', '/login', null, { username: 'qa-instructor-b', password });
  const s = await call('POST', '/login', null, { username: 'qa-student', password });
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(s.status, 200);
  assert.equal((await call('PUT', '/assignment', s.cookie, defaults)).status, 403);
  await call('PUT', '/assignment', a.cookie, { ...defaults, course: 'Synthetic course A' });
  assert.equal((await call('POST', '/submission', s.cookie, { title: 'Course A example', text: 'Synthetic paragraph', report: { mode: 'none' } })).status, 200);
  const list = await call('GET', '/roster', a.cookie);
  const id = list.body[0].id;
  const detail = (await call('PUT', `/submissions/${id}/question`, a.cookie, { paragraph: 0, text: 'Explain your reasoning.' })).body;
  const q = detail.questions[0];
  const evaluated = await call('PUT', `/submissions/${id}/evaluation`, a.cookie, { questionId:q.id, questionText:q.text, reason:2, transfer:1, memo:'Synthetic QA' });
  assert.equal(evaluated.status, 200);
  await call('PUT', '/assignment', b.cookie, { ...defaults, course: 'Synthetic course B' });
  const viewA = await call('GET', '/assignment', a.cookie);
  const viewB = await call('GET', '/roster', b.cookie);
  const second = await call('POST', '/submission', s.cookie, { title:'Course B example', text:'Synthetic second paragraph', report: { mode: 'none' } });
  console.log(JSON.stringify({
    source: 'Synthetic local fixture; not a Canvas teacher account',
    instructor_workflow: evaluated.status === 200,
    student_cannot_edit_assignment: true,
    course_A_settings_replaced_by_B: viewA.body.course === 'Synthetic course B',
    instructor_B_sees_A_submission: viewB.body.some(item => item.id === id),
    submission_for_second_course_status: second.status,
    verdict: 'Current app has one shared assignment; course and instructor isolation are not implemented',
  }, null, 2));
} finally { app.close(); rmSync(folder, { recursive:true, force:true }); }
