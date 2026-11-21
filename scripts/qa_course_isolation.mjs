// Diagnostic only: use synthetic in-memory data; never connect to school Canvas.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.js';
import { createApp } from '../server/app.js';

const folder = mkdtempSync(join(tmpdir(), 'munyeon-course-qa-'));
const database = join(folder, 'fixture.sqlite');
const password = randomBytes(24).toString('base64url');
const seed = openStore(database, { demo: false });
for (const [username, role] of [['qa-instructor-a', 'teacher'], ['qa-instructor-b', 'teacher'], ['qa-student', 'student']]) {
  seed.createAccount({ username, role, name: username, password });
}
seed.db.close();
const origin = 'https://qa.invalid';
const app = createApp({ database, origin });
async function call(method, path, cookie, data) {
  const response = await app.handle(new Request(origin + (path.startsWith('/api') ? path : '/api/v1' + path), {
    method, headers: { Origin: origin, Cookie: cookie || '', 'Content-Type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {}),
  }));
  return { status: response.status, body: response.status === 204 ? null : await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
try {
  const [a, b, s] = await Promise.all(['qa-instructor-a', 'qa-instructor-b', 'qa-student']
    .map(username => call('POST', '/api/login', null, { username, password }).then(result => result.cookie)));
  // 두 교수자가 각자 과목을 만들고 같은 학생을 등록한다.
  async function prepare(cookie, name) {
    const course = (await call('POST', '/courses', cookie, { name, sections: ['01분반'] })).body;
    await call('POST', `/courses/${course.id}/members`, cookie, { username: 'qa-student', sectionId: course.sections[0].id });
    const assignment = (await call('POST', `/courses/${course.id}/assignments`, cookie, { title: name + ' assignment', sectionIds: [course.sections[0].id] })).body;
    await call('POST', `/assignments/${assignment.id}/status`, cookie, { status: 'published' });
    return { course, assignment };
  }
  const first = await prepare(a, 'Synthetic course A');
  const second = await prepare(b, 'Synthetic course B');
  for (const [{ assignment }, title] of [[first, 'Course A example'], [second, 'Course B example']]) {
    await call('PUT', `/assignments/${assignment.id}/draft`, s, { revision: 0, title, body: 'Synthetic paragraph', items: [], objections: [], noAi: true });
    assert.equal((await call('POST', `/assignments/${assignment.id}/submission`, s, { clientRequestId: title, revision: 1 })).status, 200);
  }
  const rosterA = (await call('GET', `/assignments/${first.assignment.id}/roster`, a)).body.items;
  const submissionA = rosterA[0].submissionId;
  console.log(JSON.stringify({
    source: 'Synthetic local fixture; not a Canvas teacher account',
    instructor_A_courses: (await call('GET', '/courses', a)).body.items.map(item => item.name),
    instructor_B_reads_A_course: (await call('GET', '/courses/' + first.course.id, b)).status,
    instructor_B_reads_A_submission: (await call('GET', '/submissions/' + submissionA, b)).status,
    instructor_B_changes_A_assignment: (await call('POST', `/assignments/${first.assignment.id}/status`, b, { status: 'closed' })).status,
    student_assignments_across_courses: (await call('GET', '/my/assignments', s)).body.items.map(item => item.courseName),
    student_edits_course: (await call('PATCH', '/courses/' + first.course.id, s, { name: 'x' })).status,
    verdict: 'Courses, rosters, assignments and submissions are isolated per instructor; 404 means the resource is outside the caller scope',
  }, null, 2));
} finally {
  app.close();
  rmSync(folder, { recursive: true, force: true });
}
