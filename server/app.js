import { createHash } from 'node:crypto';
import { createModel } from './model.js';
import { openStore, freezeItems, freezeSystemLinks } from './store.js';
import { extractText, TEXT_LIMIT } from './extract.js';
import {
  ACTIVITIES, STAGES, USAGES, normalizeText, paragraphAt, paragraphRanges, relocate, similarity,
} from '../shared/text.js';

function fail(status, message, code = undefined) {
  throw Object.assign(new Error(message), { status, code });
}
function text(value, label, max, optional = false) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) fail(400, label + '을(를) 확인해 주세요.', 'INVALID_INPUT');
  return value.trim();
}
function integer(value, label = '선택한 값') {
  if (!Number.isInteger(value) || value < 0) fail(400, label + '을(를) 확인해 주세요.', 'INVALID_INPUT');
  return value;
}
function moment(value) {
  if (value == null || value === '') return null;
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) fail(400, '마감 시각을 확인해 주세요.', 'INVALID_INPUT');
  return date.toISOString();
}
const json = value => JSON.parse(value);
const now = () => new Date().toISOString();
function quoteOf(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 6000) fail(400, '연결 문장을 확인해 주세요.', 'INVALID_INPUT');
  return value;
}
const restrictPattern = /(대신|써\s*줘|써\s*주|작성해\s*줘|작성해\s*주|완성해\s*줘|만들어\s*줘|써줄래|고쳐\s*써)/;

export function createApp({ database, model = createModel(), origin = null, aiDailyLimit = 120 }) {
  const store = openStore(database, { demo: !origin });
  const { get, all, run, insert, transaction } = store;
  const cookieName = origin ? '__Host-munyeon' : 'munyeon';
  const cookie = token => cookieName + '=' + (token || '') + '; Path=/; HttpOnly; SameSite=Strict' +
    (origin ? '; Secure' : '') + '; Max-Age=' + (token ? '28800' : '0');
  const tokenPattern = new RegExp('(?:^|;\\s*)' + cookieName + '=([a-f0-9]{64})(?:;|$)');
  const routes = [];
  const route = (method, path, role, handle) => routes.push({
    method, role, handle, pattern: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>\\d+)') + '$'),
  });
  const session = user => ({ user: user ?? null, model: model.enabled ? model.label : null, demo: !origin });

  // ── 접근 범위 ───────────────────────────────────────────────
  const ownedCourse = (user, id) => get('SELECT * FROM courses WHERE id=? AND owner_id=?', id, user.id) ?? fail(404, '과목을 찾을 수 없어요.', 'NOT_FOUND');
  const ownedAssignment = (user, id) => get(`SELECT assignments.* FROM assignments JOIN courses ON courses.id=assignments.course_id
    WHERE assignments.id=? AND courses.owner_id=?`, id, user.id) ?? fail(404, '과제를 찾을 수 없어요.', 'NOT_FOUND');
  const ownedSubmission = (user, id) => get(`SELECT submissions.*, assignments.course_id FROM submissions
    JOIN assignments ON assignments.id=submissions.assignment_id JOIN courses ON courses.id=assignments.course_id
    WHERE submissions.id=? AND courses.owner_id=?`, id, user.id) ?? fail(404, '제출물을 찾을 수 없어요.', 'NOT_FOUND');
  function enrolledAssignment(user, id) {
    const row = get(`SELECT assignments.*, sections.name AS section_name, courses.name AS course_name FROM assignments
      JOIN courses ON courses.id=assignments.course_id
      JOIN enrollments ON enrollments.course_id=assignments.course_id AND enrollments.student_id=?
      JOIN assignment_sections ON assignment_sections.assignment_id=assignments.id AND assignment_sections.section_id=enrollments.section_id
      JOIN sections ON sections.id=enrollments.section_id
      WHERE assignments.id=? AND assignments.status!='draft'`, user.id, id);
    return row ?? fail(404, '과제를 찾을 수 없어요.', 'NOT_FOUND');
  }
  const isOpen = assignment => assignment.status === 'published' && (!assignment.deadline_at || Date.now() < Date.parse(assignment.deadline_at));
  function requireOpen(assignment) {
    if (assignment.status === 'closed') fail(409, '마감된 과제예요.', 'ASSIGNMENT_CLOSED');
    if (!isOpen(assignment)) fail(409, '제출 마감이 지났어요. 작성한 초안은 남아 있어요.', 'DEADLINE_PASSED');
  }
  const snapshotOf = assignment => json(get('SELECT snapshot FROM assignment_versions WHERE id=?', assignment.version_id).snapshot);

  function reserveModelCall(user) {
    if (!origin || !model.enabled) return;
    transaction(() => {
      if (!store.takeLimit('ai:user:' + user.id, 20, 60 * 60_000) || !store.takeLimit('ai:instance', aiDailyLimit, 24 * 60 * 60_000)) {
        fail(429, 'AI 사용 한도에 도달했어요. 잠시 뒤 다시 시도해 주세요.', 'RATE_LIMITED');
      }
    });
  }

  // ── 세션 ────────────────────────────────────────────────────
  route('GET', '/api/session', null, ({ user }) => session(user));
  route('POST', '/api/login', null, ({ body, token, ip }) => {
    const username = text(body.username, '아이디', 60);
    const password = text(body.password, '비밀번호', 128);
    if (origin) {
      run('DELETE FROM rate_limits WHERE expires<=?', Date.now());
      if (!store.takeLimit('login:ip:' + ip, 60, 15 * 60_000) ||
          !store.takeLimit('login:pair:' + ip + ':' + username.toLowerCase(), 8, 15 * 60_000)) {
        fail(429, '로그인 시도가 많아요. 잠시 뒤 다시 시도해 주세요.', 'RATE_LIMITED');
      }
    }
    const fresh = store.signIn(username, password);
    if (!fresh) fail(401, '아이디와 비밀번호를 확인해 주세요.', 'LOGIN_FAILED');
    store.signOut(token);
    return Response.json(session(store.userFor(fresh)), { headers: { 'Set-Cookie': cookie(fresh), 'Cache-Control': 'no-store' } });
  });
  route('POST', '/api/logout', null, ({ token }) => {
    store.signOut(token);
    return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(null) } });
  });

  // ── 과목 ────────────────────────────────────────────────────
  route('GET', '/api/v1/courses', 'member', ({ user }) => {
    if (user.role === 'student') {
      return { items: all(`SELECT courses.id, courses.name, sections.id AS sectionId, sections.name AS sectionName FROM enrollments
        JOIN courses ON courses.id=enrollments.course_id JOIN sections ON sections.id=enrollments.section_id
        WHERE enrollments.student_id=? ORDER BY courses.name`, user.id) };
    }
    const courses = all('SELECT id, name FROM courses WHERE owner_id=? ORDER BY id', user.id);
    return { items: courses.map(course => ({ ...course,
      sections: all(`SELECT sections.id, sections.name, COUNT(enrollments.student_id) AS students,
        (SELECT COUNT(*) FROM assignment_sections WHERE section_id=sections.id) AS assignments
        FROM sections LEFT JOIN enrollments ON enrollments.section_id=sections.id
        WHERE sections.course_id=? GROUP BY sections.id ORDER BY sections.name`, course.id) })) };
  });
  route('POST', '/api/v1/courses', 'teacher', ({ user, body }) => transaction(() => {
    const name = text(body.name, '과목명', 120);
    const sections = Array.isArray(body.sections) && body.sections.length ? body.sections : ['01분반'];
    const id = insert('INSERT INTO courses(owner_id,name,created_at) VALUES(?,?,?)', user.id, name, now());
    for (const section of new Set(sections.map(value => text(value, '분반 이름', 40)))) run('INSERT INTO sections(course_id,name) VALUES(?,?)', id, section);
    return courseDetail(user, id);
  }));
  function courseDetail(user, id) {
    const course = ownedCourse(user, id);
    return {
      id: course.id, name: course.name, learningGoal: course.learning_goal, instructions: course.instructions,
      examples: json(course.examples), settingsRevision: course.settings_revision,
      sections: all('SELECT id, name FROM sections WHERE course_id=? ORDER BY name', id),
      members: all(`SELECT users.id AS studentId, users.name, users.username, enrollments.section_id AS sectionId FROM enrollments
        JOIN users ON users.id=enrollments.student_id WHERE enrollments.course_id=? ORDER BY users.name`, id),
      materials: all('SELECT id, name, body, version, updated_at AS updatedAt FROM materials WHERE course_id=? ORDER BY id', id),
    };
  }
  route('GET', '/api/v1/courses/:course', 'teacher', ({ user, params }) => courseDetail(user, params.course));
  route('PATCH', '/api/v1/courses/:course', 'teacher', ({ user, params, body }) => transaction(() => {
    const course = ownedCourse(user, params.course);
    const name = body.name === undefined ? course.name : text(body.name, '과목명', 120);
    const learningGoal = body.learningGoal === undefined ? course.learning_goal : text(body.learningGoal, '학습 목표', 2000, true);
    const instructions = body.instructions === undefined ? course.instructions : text(body.instructions, '응답 지침', 4000, true);
    let examples = json(course.examples);
    if (body.examples !== undefined) {
      if (!Array.isArray(body.examples) || body.examples.length > 20) fail(400, '예시 Q&A를 확인해 주세요.', 'INVALID_INPUT');
      examples = body.examples.map(item => ({ question: text(item?.question, '예시 질문', 1000), answer: text(item?.answer, '모범 답변', 3000) }));
    }
    const changed = learningGoal !== course.learning_goal || instructions !== course.instructions || JSON.stringify(examples) !== course.examples;
    run('UPDATE courses SET name=?, learning_goal=?, instructions=?, examples=?, settings_revision=settings_revision+? WHERE id=?',
      name, learningGoal, instructions, JSON.stringify(examples), changed ? 1 : 0, course.id);
    return courseDetail(user, course.id);
  }));
  route('POST', '/api/v1/courses/:course/sections', 'teacher', ({ user, params, body }) => transaction(() => {
    const course = ownedCourse(user, params.course);
    const name = text(body.name, '분반 이름', 40);
    if (get('SELECT 1 FROM sections WHERE course_id=? AND name=?', course.id, name)) fail(409, '이미 있는 분반이에요.', 'DUPLICATE');
    run('INSERT INTO sections(course_id,name) VALUES(?,?)', course.id, name);
    return courseDetail(user, course.id);
  }));
  const ownedSection = (course, id) => get('SELECT * FROM sections WHERE id=? AND course_id=?', id, course.id) ?? fail(400, '분반을 확인해 주세요.', 'INVALID_INPUT');
  route('POST', '/api/v1/courses/:course/members', 'teacher', ({ user, params, body }) => transaction(() => {
    const course = ownedCourse(user, params.course);
    const section = ownedSection(course, body.sectionId);
    const student = get("SELECT id FROM users WHERE username=? AND role='student'", text(body.username, '학생 아이디', 60)) ??
      fail(404, '학생 계정을 찾을 수 없어요. 아이디를 확인해 주세요.', 'NOT_FOUND');
    run(`INSERT INTO enrollments VALUES(?,?,?) ON CONFLICT(course_id, student_id) DO UPDATE SET section_id=excluded.section_id`,
      course.id, student.id, section.id);
    return courseDetail(user, course.id);
  }));
  route('PATCH', '/api/v1/courses/:course/members/:student', 'teacher', ({ user, params, body }) => transaction(() => {
    const course = ownedCourse(user, params.course);
    const section = ownedSection(course, body.sectionId);
    if (!run('UPDATE enrollments SET section_id=? WHERE course_id=? AND student_id=?', section.id, course.id, params.student).changes) {
      fail(404, '수강 학생을 찾을 수 없어요.', 'NOT_FOUND');
    }
    return courseDetail(user, course.id);
  }));
  route('DELETE', '/api/v1/courses/:course/members/:student', 'teacher', ({ user, params }) => transaction(() => {
    const course = ownedCourse(user, params.course);
    run('DELETE FROM enrollments WHERE course_id=? AND student_id=?', course.id, params.student);
    return courseDetail(user, course.id);
  }));
  route('POST', '/api/v1/courses/:course/materials', 'teacher', ({ user, params, body }) => transaction(() => {
    const course = ownedCourse(user, params.course);
    run('INSERT INTO materials(course_id,name,body,updated_at) VALUES(?,?,?,?)', course.id, text(body.name, '자료 이름', 160),
      text(body.body, '자료 본문', TEXT_LIMIT), now());
    return courseDetail(user, course.id);
  }));
  route('PUT', '/api/v1/courses/:course/materials/:material', 'teacher', ({ user, params, body }) => transaction(() => {
    const course = ownedCourse(user, params.course);
    const changed = run('UPDATE materials SET name=?, body=?, version=version+1, updated_at=? WHERE id=? AND course_id=?',
      text(body.name, '자료 이름', 160), text(body.body, '자료 본문', TEXT_LIMIT), now(), params.material, course.id).changes;
    if (!changed) fail(404, '자료를 찾을 수 없어요.', 'NOT_FOUND');
    return courseDetail(user, course.id);
  }));
  route('DELETE', '/api/v1/courses/:course/materials/:material', 'teacher', ({ user, params }) => transaction(() => {
    const course = ownedCourse(user, params.course);
    run('DELETE FROM materials WHERE id=? AND course_id=?', params.material, course.id);
    return courseDetail(user, course.id);
  }));
  route('POST', '/api/v1/extract', 'teacher', async ({ body }) => {
    const { name, buffer } = uploaded(body);
    const { kind, text: extracted } = await extractText(name, buffer);
    return { kind, text: extracted };
  });

  // ── 과제 ────────────────────────────────────────────────────
  function assignmentSummary(row) {
    return {
      id: row.id, courseId: row.course_id, title: row.title, status: row.status, deadlineAt: row.deadline_at, open: isOpen(row),
      sectionIds: all('SELECT section_id AS id FROM assignment_sections WHERE assignment_id=?', row.id).map(item => item.id),
    };
  }
  function teacherAssignment(row) {
    const course = get('SELECT id, name FROM courses WHERE id=?', row.course_id);
    return {
      ...assignmentSummary(row), courseName: course.name, instructions: row.instructions, stages: json(row.stages), rules: json(row.rules),
      alternativeHelp: row.alternative_help, rubric: row.rubric, revision: row.revision, versionId: row.version_id,
      sections: all('SELECT id, name FROM sections WHERE course_id=? ORDER BY name', row.course_id),
    };
  }
  function studentAssignment(row) {
    const snapshot = snapshotOf(row);
    return {
      id: row.id, courseId: row.course_id, courseName: row.course_name, sectionName: row.section_name, status: row.status,
      open: isOpen(row), title: snapshot.title, instructions: snapshot.instructions, deadlineAt: row.deadline_at,
      stages: snapshot.stages, rules: snapshot.rules, alternativeHelp: snapshot.alternativeHelp,
      materials: snapshot.materials.map(item => ({ id: item.id, name: item.name })),
    };
  }
  route('GET', '/api/v1/courses/:course/assignments', 'teacher', ({ user, params, query }) => {
    const course = ownedCourse(user, params.course);
    const section = query.get('sectionId') ? Number(query.get('sectionId')) : null;
    const rows = all(`SELECT * FROM assignments WHERE course_id=? ${section ? 'AND id IN (SELECT assignment_id FROM assignment_sections WHERE section_id=?)' : ''}
      ORDER BY COALESCE(deadline_at, '9999'), id`, ...(section ? [course.id, section] : [course.id]));
    return { items: rows.map(row => {
      const scope = section ? [section] : all('SELECT section_id FROM assignment_sections WHERE assignment_id=?', row.id).map(item => item.section_id);
      const marks = scope.map(() => '?').join(',') || 'NULL';
      const total = get(`SELECT COUNT(*) AS count FROM enrollments WHERE course_id=? AND section_id IN (${marks})`, course.id, ...scope).count;
      const submitted = get(`SELECT COUNT(*) AS count FROM submissions JOIN enrollments ON enrollments.student_id=submissions.student_id
        AND enrollments.course_id=? WHERE submissions.assignment_id=? AND enrollments.section_id IN (${marks})`, course.id, row.id, ...scope).count;
      return { ...assignmentSummary(row), total, submitted };
    }) };
  });
  function assignmentInput(row, body, course) {
    const values = {
      title: body.title === undefined ? row?.title : text(body.title, '과제 제목', 160),
      instructions: body.instructions === undefined ? row?.instructions ?? '' : text(body.instructions, '과제 안내', 6000, true),
      deadlineAt: body.deadlineAt === undefined ? row?.deadline_at ?? null : moment(body.deadlineAt),
      alternativeHelp: body.alternativeHelp === undefined ? row?.alternative_help ?? '' : text(body.alternativeHelp, '대체 도움 안내', 1000, true),
      rubric: body.rubric === undefined ? row?.rubric ?? '' : text(body.rubric, '구술평가 기준', 2000, true),
      stages: row ? json(row.stages) : undefined, rules: row ? json(row.rules) : undefined, sectionIds: undefined,
    };
    if (!values.title) fail(400, '과제 제목을 입력해 주세요.', 'INVALID_INPUT');
    if (body.stages !== undefined) {
      if (!body.stages || typeof body.stages !== 'object') fail(400, '활용 단계를 확인해 주세요.', 'INVALID_INPUT');
      values.stages = Object.fromEntries(STAGES.map(stage => [stage, text(body.stages[stage], '활용 단계 이름', 20)]));
    }
    if (body.rules !== undefined) {
      if (!body.rules || typeof body.rules !== 'object') fail(400, '활용 기준을 확인해 주세요.', 'INVALID_INPUT');
      values.rules = Object.fromEntries(STAGES.map(stage => [stage, Object.fromEntries(Object.keys(ACTIVITIES).map(activity => {
        const decision = body.rules[stage]?.[activity];
        if (!['allowed', 'restricted'].includes(decision)) fail(400, '활용 기준을 확인해 주세요.', 'INVALID_INPUT');
        return [activity, decision];
      }))]));
    }
    if (body.sectionIds !== undefined) {
      if (!Array.isArray(body.sectionIds)) fail(400, '대상 분반을 확인해 주세요.', 'INVALID_INPUT');
      values.sectionIds = [...new Set(body.sectionIds)].map(id => ownedSection(course, id).id);
    }
    return values;
  }
  route('POST', '/api/v1/courses/:course/assignments', 'teacher', ({ user, params, body }) => transaction(() => {
    const course = ownedCourse(user, params.course);
    const values = assignmentInput(null, body, course);
    const id = store.createAssignment({ courseId: course.id, ...values, sectionIds: values.sectionIds ?? [],
      stages: values.stages, rules: values.rules });
    return teacherAssignment(get('SELECT * FROM assignments WHERE id=?', id));
  }));
  route('GET', '/api/v1/assignments/:assignment', 'member', ({ user, params }) => user.role === 'teacher'
    ? teacherAssignment(ownedAssignment(user, params.assignment)) : studentAssignment(enrolledAssignment(user, params.assignment)));
  route('PATCH', '/api/v1/assignments/:assignment', 'teacher', ({ user, params, body }) => transaction(() => {
    const row = ownedAssignment(user, params.assignment);
    if (body.revision !== row.revision) fail(409, '다른 곳에서 과제 설정이 바뀌었어요. 새로고침한 뒤 다시 저장해 주세요.', 'REVISION_CONFLICT');
    const course = get('SELECT * FROM courses WHERE id=?', row.course_id);
    const values = assignmentInput(row, body, course);
    run(`UPDATE assignments SET title=?, instructions=?, deadline_at=?, alternative_help=?, rubric=?, stages=?, rules=?,
      revision=revision+1, updated_at=? WHERE id=?`, values.title, values.instructions, values.deadlineAt, values.alternativeHelp,
    values.rubric, JSON.stringify(values.stages), JSON.stringify(values.rules), now(), row.id);
    if (values.sectionIds) {
      run('DELETE FROM assignment_sections WHERE assignment_id=?', row.id);
      for (const id of values.sectionIds) run('INSERT INTO assignment_sections VALUES(?,?)', row.id, id);
    }
    if (row.status !== 'draft') store.publishVersion(row.id);
    return teacherAssignment(get('SELECT * FROM assignments WHERE id=?', row.id));
  }));
  route('POST', '/api/v1/assignments/:assignment/status', 'teacher', ({ user, params, body }) => transaction(() => {
    const row = ownedAssignment(user, params.assignment);
    if (!['published', 'closed'].includes(body.status)) fail(400, '과제 상태를 확인해 주세요.', 'INVALID_INPUT');
    if (body.status === 'published' && !get('SELECT 1 FROM assignment_sections WHERE assignment_id=?', row.id)) {
      fail(422, '공개하기 전에 대상 분반을 하나 이상 선택해 주세요.', 'NO_SECTIONS');
    }
    run('UPDATE assignments SET status=?, revision=revision+1, updated_at=? WHERE id=?', body.status, now(), row.id);
    if (body.status === 'published') store.publishVersion(row.id);
    return teacherAssignment(get('SELECT * FROM assignments WHERE id=?', row.id));
  }));
  route('GET', '/api/v1/assignments/:assignment/roster', 'teacher', ({ user, params, query }) => {
    const row = ownedAssignment(user, params.assignment);
    const section = query.get('sectionId') ? Number(query.get('sectionId')) : null;
    const rows = all(`SELECT users.id AS studentId, users.name, sections.id AS sectionId, sections.name AS sectionName,
        submissions.id AS submissionId, submissions.updated_at AS submittedAt,
        (SELECT MAX(no) FROM submission_versions WHERE submission_id=submissions.id) AS versionNo,
        (SELECT COUNT(*) FROM questions WHERE submission_id=submissions.id AND selected=1) AS selectedQuestions,
        (SELECT reason FROM evaluations WHERE submission_id=submissions.id) AS reason,
        (SELECT COUNT(*) FROM policy_events WHERE assignment_id=? AND student_id=users.id AND status='pending') AS pendingEvents
      FROM enrollments JOIN users ON users.id=enrollments.student_id JOIN sections ON sections.id=enrollments.section_id
      JOIN assignment_sections ON assignment_sections.section_id=enrollments.section_id AND assignment_sections.assignment_id=?
      LEFT JOIN submissions ON submissions.assignment_id=? AND submissions.student_id=users.id
      WHERE enrollments.course_id=? ${section ? 'AND enrollments.section_id=?' : ''}
      ORDER BY submissions.id IS NULL, users.name`, row.id, row.id, row.id, row.course_id, ...(section ? [section] : []));
    return { open: isOpen(row), items: rows.map(item => ({ ...item,
      status: !item.submissionId ? 'unsubmitted' : item.reason != null ? 'evaluated' : item.selectedQuestions ? 'questions_ready' : 'submitted' })) };
  });

  // ── 학생: 내 과제 ───────────────────────────────────────────
  route('GET', '/api/v1/my/assignments', 'student', ({ user }) => ({ items: all(`
    SELECT assignments.*, courses.name AS course_name, sections.name AS section_name,
      (SELECT MAX(no) FROM submission_versions JOIN submissions ON submissions.id=submission_versions.submission_id
        WHERE submissions.assignment_id=assignments.id AND submissions.student_id=?) AS version_no,
      (SELECT updated_at FROM submissions WHERE assignment_id=assignments.id AND student_id=?) AS submitted_at,
      (SELECT updated_at FROM drafts WHERE assignment_id=assignments.id AND student_id=?) AS draft_at
    FROM assignments JOIN courses ON courses.id=assignments.course_id
    JOIN enrollments ON enrollments.course_id=courses.id AND enrollments.student_id=?
    JOIN assignment_sections ON assignment_sections.assignment_id=assignments.id AND assignment_sections.section_id=enrollments.section_id
    JOIN sections ON sections.id=enrollments.section_id
    WHERE assignments.status!='draft' ORDER BY courses.name, COALESCE(assignments.deadline_at,'9999'), assignments.id`, user.id, user.id, user.id, user.id)
    .map(row => ({ id: row.id, courseId: row.course_id, courseName: row.course_name, sectionName: row.section_name,
      title: snapshotOf(row).title, deadlineAt: row.deadline_at, status: row.status, open: isOpen(row),
      versionNo: row.version_no, submittedAt: row.submitted_at, draftAt: row.draft_at })) }));

  // ── 학생: 과제 AI ───────────────────────────────────────────
  const turnFields = 'id, stage, activity, prompt, reply, action, match_type AS matchType, created_at AS createdAt';
  const ownTurns = (assignment, user) => all(`SELECT ${turnFields} FROM chat_turns WHERE assignment_id=? AND student_id=? ORDER BY id`, assignment, user.id);
  route('GET', '/api/v1/assignments/:assignment/chat', 'student', ({ user, params }) => {
    const assignment = enrolledAssignment(user, params.assignment);
    return { items: ownTurns(assignment.id, user) };
  });
  route('POST', '/api/v1/assignments/:assignment/chat', 'student', async ({ user, params, body }) => {
    const assignment = enrolledAssignment(user, params.assignment);
    requireOpen(assignment);
    if (!model.enabled) fail(503, '이 서버에서는 과제 AI 대화가 꺼져 있어요.', 'AI_DISABLED');
    const requestId = text(body.clientRequestId, '요청 ID', 80);
    const repeated = get(`SELECT ${turnFields} FROM chat_turns WHERE assignment_id=? AND student_id=? AND client_request_id=?`, assignment.id, user.id, requestId);
    if (repeated) return repeated;
    if (!STAGES.includes(body.stage)) fail(400, '활용 단계를 선택해 주세요.', 'INVALID_INPUT');
    if (!Object.hasOwn(ACTIVITIES, body.activity)) fail(400, '도움 유형을 선택해 주세요.', 'INVALID_INPUT');
    const prompt = text(body.text, '질문', 3000);
    const snapshot = snapshotOf(assignment);
    const decision = snapshot.rules[body.stage]?.[body.activity] ?? 'unspecified';
    const stageName = snapshot.stages[body.stage];
    let reply;
    let action = 'answered';
    let matchType = decision === 'unspecified' ? 'unspecified' : null;
    if (decision === 'restricted') {
      action = 'restricted';
      matchType = 'explicit_restriction';
      reply = `${stageName} 단계에서 '${ACTIVITIES[body.activity]}'은(는) 이 과제에서 제한된 도움이에요. ` +
        (snapshot.alternativeHelp || '대신 핵심 주장과 근거를 스스로 정리할 수 있도록 질문을 드릴게요. 이 부분에서 말하고 싶은 주장은 무엇인가요?');
    } else {
      const cautious = body.activity !== 'write' && snapshot.rules[body.stage]?.write === 'restricted' && restrictPattern.test(prompt);
      if (cautious) {
        action = 'hinted';
        matchType = 'possible_match';
      }
      const excerpts = snapshot.materials.flatMap(material => paragraphRanges(material.body).map(part => ({ name: material.name, text: part.text })))
        .map(part => ({ ...part, score: similarity(prompt, part.text) })).filter(part => part.score > 0.05)
        .sort((a, b) => b.score - a.score).slice(0, 2).map(part => part.name + ': ' + part.text.slice(0, 800));
      const history = all(`SELECT prompt, reply FROM chat_turns WHERE assignment_id=? AND student_id=? AND action!='restricted'
        ORDER BY id DESC LIMIT 8`, assignment.id, user.id).reverse();
      reserveModelCall(user);
      reply = await model.tutor({ snapshot, stageName, activity: body.activity, cautious, excerpts }, prompt, history);
    }
    return transaction(() => {
      const existing = get(`SELECT ${turnFields} FROM chat_turns WHERE assignment_id=? AND student_id=? AND client_request_id=?`, assignment.id, user.id, requestId);
      if (existing) return existing;
      const stamp = now();
      const id = insert(`INSERT INTO chat_turns(assignment_id,student_id,version_id,client_request_id,stage,activity,prompt,reply,action,match_type,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`, assignment.id, user.id, assignment.version_id, requestId, body.stage, body.activity, prompt, reply, action, matchType, stamp);
      if (matchType === 'explicit_restriction' || matchType === 'possible_match') {
        run('INSERT INTO policy_events(turn_id,assignment_id,student_id,version_id,match_type,action,created_at) VALUES(?,?,?,?,?,?,?)',
          id, assignment.id, user.id, assignment.version_id, matchType, action === 'restricted' ? 'hint' : 'cautious_answer', stamp);
      }
      return get(`SELECT ${turnFields} FROM chat_turns WHERE id=?`, id);
    });
  });

  // ── 학생: 초안 ──────────────────────────────────────────────
  const fileInfo = id => id ? get('SELECT id, name, kind, size, created_at AS createdAt FROM files WHERE id=?', id) ?? null : null;
  function draftView(assignment, user) {
    const row = get('SELECT * FROM drafts WHERE assignment_id=? AND student_id=?', assignment.id, user.id);
    if (!row) return { title: '', body: '', items: [], objections: [], noAi: false, revision: 0, updatedAt: null, file: null, fileText: null };
    const file = row.file_id ? get('SELECT text FROM files WHERE id=?', row.file_id) : null;
    return { title: row.title, body: row.body, items: json(row.items), objections: json(row.objections), noAi: Boolean(row.no_ai),
      revision: row.revision, updatedAt: row.updated_at, file: fileInfo(row.file_id), editedAfterUpload: file ? normalizeText(file.text).trim() !== row.body.trim() : false };
  }
  route('GET', '/api/v1/assignments/:assignment/draft', 'student', ({ user, params }) =>
    draftView(enrolledAssignment(user, params.assignment), user));
  route('PUT', '/api/v1/assignments/:assignment/draft', 'student', ({ user, params, body }) => transaction(() => {
    const assignment = enrolledAssignment(user, params.assignment);
    requireOpen(assignment);
    const current = get('SELECT revision FROM drafts WHERE assignment_id=? AND student_id=?', assignment.id, user.id)?.revision ?? 0;
    if (body.revision !== current) fail(409, '다른 창에서 초안이 바뀌었어요. 새로고침한 뒤 이어서 작성해 주세요.', 'REVISION_CONFLICT');
    const title = text(body.title, '제목', 160, true);
    const draftBody = body.body == null ? '' : typeof body.body === 'string' && body.body.length <= TEXT_LIMIT ? normalizeText(body.body)
      : fail(413, '본문이 너무 길어요.', 'TEXT_TOO_LONG');
    const turnIds = new Set(all('SELECT id FROM chat_turns WHERE assignment_id=? AND student_id=?', assignment.id, user.id).map(row => row.id));
    if (!Array.isArray(body.items) || body.items.length > 80) fail(400, '활용 항목을 확인해 주세요.', 'INVALID_INPUT');
    const items = body.items.map(item => {
      const id = text(item?.id, '항목 ID', 40);
      const linked = Array.isArray(item.turnIds) ? [...new Set(item.turnIds)] : [];
      if (linked.length > 20 || linked.some(turn => !turnIds.has(turn))) fail(400, '연결한 대화를 확인해 주세요.', 'INVALID_INPUT');
      if (!STAGES.includes(item.stage) || !Object.hasOwn(USAGES, item.usage)) fail(400, '활용 단계와 방식을 확인해 주세요.', 'INVALID_INPUT');
      const anchored = Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end > item.start && item.end <= draftBody.length;
      return relocate({ id, turnIds: linked, stage: item.stage, usage: item.usage,
        explanation: text(item.explanation, '활용 설명', 2000, true), quote: quoteOf(item.quote),
        start: anchored ? item.start : null, end: anchored ? item.end : null, wasLost: item.status === 'lost' }, draftBody);
    }).map(({ wasLost, ...item }) => wasLost && item.status !== 'ok' ? { ...item, status: 'lost' } : item);
    if (!Array.isArray(body.objections) || body.objections.length > 100) fail(400, '이의 내용을 확인해 주세요.', 'INVALID_INPUT');
    const objections = body.objections.map(entry => ({ key: text(entry?.key, '이의 대상', 120), reason: text(entry.reason, '이의 이유', 1000) }));
    let fileId = null;
    if (body.fileId != null) {
      fileId = get('SELECT id FROM files WHERE id=? AND owner_id=? AND assignment_id=?', body.fileId, user.id, assignment.id)?.id ??
        fail(400, '첨부 파일을 확인해 주세요.', 'INVALID_INPUT');
    }
    const stamp = now();
    run(`INSERT INTO drafts(assignment_id,student_id,title,body,file_id,items,objections,no_ai,revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(assignment_id,student_id) DO UPDATE SET title=excluded.title, body=excluded.body, file_id=excluded.file_id,
      items=excluded.items, objections=excluded.objections, no_ai=excluded.no_ai, revision=excluded.revision, updated_at=excluded.updated_at`,
    assignment.id, user.id, title, draftBody, fileId, JSON.stringify(items), JSON.stringify(objections), body.noAi ? 1 : 0, current + 1, stamp);
    return draftView(assignment, user);
  }));
  function uploaded(body) {
    const name = text(body.fileName, '파일 이름', 200);
    if (typeof body.data !== 'string' || body.data.length > 14_500_000) fail(413, '10 MB 이하의 파일을 올려 주세요.', 'FILE_TOO_LARGE');
    return { name, buffer: Buffer.from(body.data, 'base64') };
  }
  route('POST', '/api/v1/assignments/:assignment/draft/import', 'student', async ({ user, params, body }) => {
    const assignment = enrolledAssignment(user, params.assignment);
    requireOpen(assignment);
    const { name, buffer } = uploaded(body);
    const { kind, mime, text: extracted } = await extractText(name, buffer);
    const id = insert(`INSERT INTO files(owner_id,course_id,assignment_id,name,kind,mime,size,sha256,text,content,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, user.id, assignment.course_id, assignment.id, name, kind, mime, buffer.length,
    createHash('sha256').update(buffer).digest('hex'), extracted, buffer, now());
    return { file: fileInfo(id), text: extracted };
  });

  // ── 학생: 제출 ──────────────────────────────────────────────
  function versionView(submission, no) {
    const version = no ? get('SELECT * FROM submission_versions WHERE submission_id=? AND no=?', submission.id, no)
      : get('SELECT * FROM submission_versions WHERE submission_id=? ORDER BY no DESC LIMIT 1', submission.id);
    if (!version) fail(404, '제출 회차를 찾을 수 없어요.', 'NOT_FOUND');
    const paragraphs = paragraphRanges(version.body);
    const locate = item => item.start == null ? null : paragraphAt(version.body, item.start)?.index ?? null;
    return {
      no: version.no, title: version.title, body: version.body, createdAt: version.created_at, noAi: Boolean(version.no_ai),
      paragraphs, file: fileInfo(version.file_id), editedAfterUpload: Boolean(version.edited_after_upload),
      items: json(version.items).map(item => ({ ...item, paragraph: locate(item) })),
      systemLinks: json(version.system_links),
      snapshot: version.assignment_version_id ? json(get('SELECT snapshot FROM assignment_versions WHERE id=?', version.assignment_version_id).snapshot) : null,
    };
  }
  const versionList = submission => all('SELECT no, title, created_at AS createdAt FROM submission_versions WHERE submission_id=? ORDER BY no', submission.id);
  route('GET', '/api/v1/assignments/:assignment/submission', 'student', ({ user, params, query }) => {
    const assignment = enrolledAssignment(user, params.assignment);
    const submission = get('SELECT * FROM submissions WHERE assignment_id=? AND student_id=?', assignment.id, user.id);
    if (!submission) return { submission: null };
    const { snapshot, ...version } = versionView(submission, query.get('no') ? Number(query.get('no')) : null);
    return { submission: { id: submission.id, versions: versionList(submission), version } };
  });
  route('POST', '/api/v1/assignments/:assignment/submission', 'student', ({ user, params, body }) => transaction(() => {
    const assignment = enrolledAssignment(user, params.assignment);
    requireOpen(assignment);
    const requestId = text(body.clientRequestId, '요청 ID', 80);
    const draft = get('SELECT * FROM drafts WHERE assignment_id=? AND student_id=?', assignment.id, user.id) ?? fail(422, '저장된 초안이 없어요.', 'REPORT_INCOMPLETE');
    const repeated = get(`SELECT submission_versions.* FROM submission_versions JOIN submissions ON submissions.id=submission_versions.submission_id
      WHERE submissions.assignment_id=? AND submissions.student_id=? AND client_request_id=?`, assignment.id, user.id, requestId);
    if (repeated) {
      if (repeated.body !== draft.body || repeated.title !== draft.title) fail(409, '같은 제출 요청의 내용이 달라요. 다시 제출해 주세요.', 'DUPLICATE_REQUEST');
    } else {
      if (body.revision !== draft.revision) fail(409, '제출하기 전에 초안이 바뀌었어요. 내용을 다시 확인해 주세요.', 'REVISION_CONFLICT');
      if (!draft.title.trim() || !draft.body.trim()) fail(422, '제목과 본문을 입력해 주세요.', 'REPORT_INCOMPLETE');
      const items = json(draft.items);
      if (items.some(item => item.status === 'lost')) fail(422, '위치를 다시 지정해야 하는 활용 항목이 있어요.', 'ITEMS_NEED_RELOCATION');
      if (items.some(item => !item.explanation.trim())) fail(422, '모든 활용 항목에 설명을 적어 주세요.', 'REPORT_INCOMPLETE');
      if (!items.length && !draft.no_ai) fail(422, 'AI 활용 내용을 기록하거나, 사용하지 않았다고 확인해 주세요.', 'REPORT_INCOMPLETE');
      const turns = all(`SELECT ${turnFields} FROM chat_turns WHERE assignment_id=? AND student_id=?`, assignment.id, user.id);
      const file = draft.file_id ? get('SELECT text FROM files WHERE id=?', draft.file_id) : null;
      const stamp = now();
      let submission = get('SELECT * FROM submissions WHERE assignment_id=? AND student_id=?', assignment.id, user.id);
      if (!submission) {
        insert('INSERT INTO submissions(assignment_id,student_id,created_at,updated_at) VALUES(?,?,?,?)', assignment.id, user.id, stamp, stamp);
        submission = get('SELECT * FROM submissions WHERE assignment_id=? AND student_id=?', assignment.id, user.id);
      }
      const no = (get('SELECT MAX(no) AS no FROM submission_versions WHERE submission_id=?', submission.id).no ?? 0) + 1;
      run(`INSERT INTO submission_versions(submission_id,no,title,body,items,system_links,no_ai,file_id,edited_after_upload,assignment_version_id,client_request_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, submission.id, no, draft.title, draft.body,
      JSON.stringify(freezeItems(items, new Map(turns.map(turn => [turn.id, turn])))),
      JSON.stringify(freezeSystemLinks(draft.body, turns.filter(turn => turn.action !== 'restricted'), items, json(draft.objections))),
      items.length ? 0 : draft.no_ai, draft.file_id, file ? Number(normalizeText(file.text).trim() !== draft.body.trim()) : 0,
      assignment.version_id, requestId, stamp);
      run('UPDATE submissions SET updated_at=? WHERE id=?', stamp, submission.id);
    }
    const submission = get('SELECT * FROM submissions WHERE assignment_id=? AND student_id=?', assignment.id, user.id);
    const { snapshot, ...version } = versionView(submission, null);
    return { submission: { id: submission.id, versions: versionList(submission), version } };
  }));

  // ── 교수자 검토 ─────────────────────────────────────────────
  const questionView = row => ({ id: row.id, versionNo: row.version_no, text: row.text, originalText: row.original_text, source: row.source,
    anchor: json(row.anchor), selected: Boolean(row.selected), createdAt: row.created_at, updatedAt: row.updated_at });
  function submissionDetail(user, id, no = null) {
    const submission = ownedSubmission(user, id);
    const assignment = get('SELECT * FROM assignments WHERE id=?', submission.assignment_id);
    const student = get(`SELECT users.id, users.name, sections.name AS sectionName FROM users
      LEFT JOIN enrollments ON enrollments.student_id=users.id AND enrollments.course_id=?
      LEFT JOIN sections ON sections.id=enrollments.section_id WHERE users.id=?`, assignment.course_id, submission.student_id);
    const version = versionView(submission, no);
    const versions = versionList(submission);
    return {
      id: submission.id, student, latestNo: versions.at(-1).no, versions, version,
      assignment: { id: assignment.id, title: assignment.title, courseId: assignment.course_id, deadlineAt: assignment.deadline_at, open: isOpen(assignment),
        stages: version.snapshot?.stages ?? json(assignment.stages), rubric: assignment.rubric },
      policyEvents: all(`SELECT policy_events.id, policy_events.match_type AS matchType, policy_events.action, policy_events.status,
          policy_events.memo, policy_events.created_at AS createdAt, chat_turns.stage, chat_turns.activity, chat_turns.prompt, chat_turns.reply,
          assignment_versions.snapshot
        FROM policy_events JOIN chat_turns ON chat_turns.id=policy_events.turn_id
        LEFT JOIN assignment_versions ON assignment_versions.id=policy_events.version_id
        WHERE policy_events.assignment_id=? AND policy_events.student_id=? ORDER BY policy_events.id`, assignment.id, submission.student_id)
        .map(({ snapshot, ...event }) => ({ ...event, rule: snapshot ? json(snapshot).rules[event.stage]?.[event.activity] ?? 'unspecified' : null })),
      questions: all('SELECT * FROM questions WHERE submission_id=? ORDER BY id', submission.id).map(questionView),
      evaluation: get('SELECT reason, transfer, memo, updated_at AS updatedAt FROM evaluations WHERE submission_id=?', submission.id) ?? null,
      flags: all('SELECT target, memo FROM review_flags WHERE submission_id=?', submission.id),
    };
  }
  route('GET', '/api/v1/submissions/:submission', 'teacher', ({ user, params, query }) =>
    submissionDetail(user, params.submission, query.get('no') ? Number(query.get('no')) : null));
  route('PATCH', '/api/v1/submissions/:submission/policy-events/:event', 'teacher', ({ user, params, body }) => transaction(() => {
    const submission = ownedSubmission(user, params.submission);
    if (!['pending', 'confirmed', 'dismissed'].includes(body.status)) fail(400, '확인 상태를 확인해 주세요.', 'INVALID_INPUT');
    const changed = run(`UPDATE policy_events SET status=?, memo=?, reviewed_at=? WHERE id=? AND assignment_id=? AND student_id=?`,
      body.status, text(body.memo, '메모', 2000, true), body.status === 'pending' ? null : now(), params.event, submission.assignment_id, submission.student_id).changes;
    if (!changed) fail(404, '기준 확인 항목을 찾을 수 없어요.', 'NOT_FOUND');
    return submissionDetail(user, submission.id);
  }));
  route('PUT', '/api/v1/submissions/:submission/flags', 'teacher', ({ user, params, body }) => transaction(() => {
    const submission = ownedSubmission(user, params.submission);
    const target = text(body.target, '확인 대상', 80);
    if (body.flagged) {
      run(`INSERT INTO review_flags VALUES(?,?,?,?) ON CONFLICT(submission_id,target) DO UPDATE SET memo=excluded.memo`,
        submission.id, target, text(body.memo, '메모', 2000, true), now());
    } else run('DELETE FROM review_flags WHERE submission_id=? AND target=?', submission.id, target);
    return submissionDetail(user, submission.id);
  }));
  function questionAnchor(version, anchor) {
    if (!anchor || typeof anchor !== 'object') return {};
    if (anchor.itemId != null) {
      const item = version.items.find(entry => entry.id === anchor.itemId) ?? fail(400, '질문 근거를 확인해 주세요.', 'INVALID_INPUT');
      return { itemId: item.id, start: item.start, end: item.end, quote: item.quote, paragraph: item.paragraph };
    }
    if (Number.isInteger(anchor.start) && Number.isInteger(anchor.end)) {
      if (anchor.start < 0 || anchor.end > version.body.length || anchor.end <= anchor.start) fail(400, '질문 근거를 확인해 주세요.', 'INVALID_INPUT');
      return { start: anchor.start, end: anchor.end, quote: version.body.slice(anchor.start, anchor.end), paragraph: paragraphAt(version.body, anchor.start)?.index ?? null };
    }
    return {};
  }
  route('POST', '/api/v1/submissions/:submission/questions', 'teacher', ({ user, params, body }) => transaction(() => {
    const submission = ownedSubmission(user, params.submission);
    const version = versionView(submission, null);
    const question = text(body.text, '질문', 1200);
    const stamp = now();
    run(`INSERT INTO questions(submission_id,version_no,text,original_text,source,anchor,selected,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      submission.id, version.no, question, question, 'manual', JSON.stringify(questionAnchor(version, body.anchor)), 1, stamp, stamp);
    return submissionDetail(user, submission.id);
  }));
  route('PATCH', '/api/v1/submissions/:submission/questions/:question', 'teacher', ({ user, params, body }) => transaction(() => {
    const submission = ownedSubmission(user, params.submission);
    const row = get('SELECT * FROM questions WHERE id=? AND submission_id=?', params.question, submission.id) ?? fail(404, '질문을 찾을 수 없어요.', 'NOT_FOUND');
    const value = body.text === undefined ? row.text : text(body.text, '질문', 1200);
    const selected = body.selected === undefined ? row.selected : body.selected ? 1 : 0;
    run('UPDATE questions SET text=?, selected=?, updated_at=? WHERE id=?', value, selected, now(), row.id);
    return submissionDetail(user, submission.id);
  }));
  route('DELETE', '/api/v1/submissions/:submission/questions/:question', 'teacher', ({ user, params }) => transaction(() => {
    const submission = ownedSubmission(user, params.submission);
    run('DELETE FROM questions WHERE id=? AND submission_id=?', params.question, submission.id);
    return submissionDetail(user, submission.id);
  }));
  route('POST', '/api/v1/submissions/:submission/questions/suggest', 'teacher', async ({ user, params }) => {
    const submission = ownedSubmission(user, params.submission);
    if (!model.enabled) fail(503, '이 서버에서는 질문 추천이 꺼져 있어요. 직접 작성해 주세요.', 'AI_DISABLED');
    const version = versionView(submission, null);
    reserveModelCall(user);
    const suggestions = await model.suggest(version);
    return transaction(() => {
      const stamp = now();
      for (const suggestion of suggestions) {
        const anchor = suggestion.itemId != null ? questionAnchor(version, { itemId: suggestion.itemId })
          : suggestion.paragraph != null && version.paragraphs[suggestion.paragraph]
            ? questionAnchor(version, { start: version.paragraphs[suggestion.paragraph].start, end: version.paragraphs[suggestion.paragraph].end }) : {};
        if (get('SELECT 1 FROM questions WHERE submission_id=? AND original_text=?', submission.id, suggestion.text)) continue;
        run(`INSERT INTO questions(submission_id,version_no,text,original_text,source,anchor,selected,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
          submission.id, version.no, suggestion.text, suggestion.text, 'ai_suggested', JSON.stringify(anchor), 0, stamp, stamp);
      }
      return submissionDetail(user, submission.id);
    });
  });
  route('PUT', '/api/v1/submissions/:submission/evaluation', 'teacher', ({ user, params, body }) => transaction(() => {
    const submission = ownedSubmission(user, params.submission);
    const score = value => value == null ? null : Number.isInteger(value) && value >= 0 && value <= 2 ? value : fail(400, '점수를 확인해 주세요.', 'INVALID_INPUT');
    run(`INSERT INTO evaluations VALUES(?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET reason=excluded.reason,
      transfer=excluded.transfer, memo=excluded.memo, updated_at=excluded.updated_at`,
    submission.id, score(body.reason), score(body.transfer), text(body.memo, '평가 메모', 3000, true), now());
    return submissionDetail(user, submission.id);
  }));

  // ── 파일 내려받기 ───────────────────────────────────────────
  route('GET', '/api/v1/files/:file', 'member', ({ user, params }) => {
    const file = get('SELECT * FROM files WHERE id=?', params.file);
    const allowed = file && (user.role === 'student' ? file.owner_id === user.id
      : get('SELECT 1 FROM courses WHERE id=? AND owner_id=?', file.course_id, user.id));
    if (!allowed) fail(404, '파일을 찾을 수 없어요.', 'NOT_FOUND');
    return new Response(file.content, { headers: {
      'Content-Type': file.mime, 'Cache-Control': 'private, no-store',
      'Content-Disposition': "attachment; filename=\"download." + file.kind + "\"; filename*=UTF-8''" + encodeURIComponent(file.name),
    } });
  });

  async function handle(request, { ip = 'local' } = {}) {
    try {
      const url = new URL(request.url);
      let params;
      const entry = routes.find(item => item.method === request.method && (params = url.pathname.match(item.pattern)));
      if (!entry) fail(404, '요청한 기능을 찾을 수 없어요.', 'NOT_FOUND');
      const token = request.headers.get('cookie')?.match(tokenPattern)?.[1];
      const user = store.userFor(token);
      if (entry.role && !user) fail(401, '로그인이 필요해요.', 'LOGIN_REQUIRED');
      if (entry.role && entry.role !== 'member' && user.role !== entry.role) fail(403, '이 화면에 접근할 권한이 없어요.', 'FORBIDDEN');
      let body = {};
      if (!['GET', 'HEAD'].includes(request.method)) {
        if (request.headers.get('sec-fetch-site') === 'cross-site') fail(403, '같은 사이트에서 다시 시도해 주세요.', 'FORBIDDEN');
        if (origin && request.headers.get('origin') !== origin) fail(403, '서비스 주소에서 다시 시도해 주세요.', 'FORBIDDEN');
        if (request.method !== 'DELETE') {
          if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'JSON 요청이 필요해요.', 'INVALID_INPUT');
          try { body = await request.json(); } catch { fail(400, '요청 형식을 확인해 주세요.', 'INVALID_INPUT'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '요청 형식을 확인해 주세요.', 'INVALID_INPUT');
        }
      }
      const values = Object.fromEntries(Object.entries(params.groups ?? {}).map(([key, value]) => [key, Number(value)]));
      const result = await entry.handle({ user, token, body, ip, params: values, query: url.searchParams });
      return result instanceof Response ? result : Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (!error.status) console.error(error);
      return Response.json({ error: error.status ? error.message : '서버에서 요청을 처리하지 못했어요.', code: error.code ?? 'SERVER_ERROR' }, {
        status: error.status ?? 500, headers: { 'Cache-Control': 'no-store' },
      });
    }
  }
  return { handle, ready: () => get("SELECT 1 FROM users WHERE role='teacher'") !== undefined, close: () => store.db.close(), store };
}

