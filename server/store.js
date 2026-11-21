import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { DEFAULT_STAGE_NAMES, defaultRules, paragraphRanges, similarTurns } from '../shared/text.js';

export const SCHEMA_VERSION = 2;
const legacyModes = { concept: 'explain', hint: 'explain', feedback: 'feedback' };

// 이전 버전의 과제 설정(goal·materials·help·independent)을 한 과제 설정으로 옮긴다.
export const legacyDefaults = {
  title: '대표값과 분포', course: '통계와 데이터', section: '', due: '',
  prompt: '표본 분포를 보고 적절한 대표값을 선택하고 그 이유를 설명하세요.',
  allowed: '', restricted: '', rubric: '선택의 근거와 조건 변화의 영향을 각각 0~2점으로 평가한다.',
};
export function normalizeConfig(config = {}) {
  if (typeof config.prompt === 'string') return { ...legacyDefaults, ...config };
  const prompt = [config.goal, config.materials && '참고 자료: ' + config.materials].filter(Boolean).join('\n');
  return {
    ...legacyDefaults, title: config.title ?? legacyDefaults.title, course: config.course ?? legacyDefaults.course,
    prompt: prompt || legacyDefaults.prompt, allowed: config.help ?? '',
    restricted: config.independent ? '직접 할 부분: ' + config.independent : '', rubric: config.rubric ?? legacyDefaults.rubric,
  };
}
export function normalizeEvidence(evidence) {
  if (!evidence) return { mode: 'unreported' };
  if (evidence.mode) return evidence;
  if (evidence.source === '문연 학습실') {
    return { mode: 'shared', paragraph: evidence.paragraph, explanation: evidence.explanation, question: '', excerpt: evidence.excerpt };
  }
  return { mode: 'manual', explanation: evidence.explanation };
}

export const demoAccounts = [
  { username: 'teacher', name: '김교수', role: 'teacher', password: 'munyeon-teacher' },
  { username: 'teacher2', name: '이교수', role: 'teacher', password: 'munyeon-teacher2' },
  { username: 'student', name: '김하윤', role: 'student', password: 'munyeon-student' },
  { username: 'student2', name: '박서준', role: 'student', password: 'munyeon-student2' },
  { username: 'student3', name: '이유진', role: 'student', password: 'munyeon-student3' },
];

const digest = token => createHash('sha256').update(token).digest('hex');
const now = () => new Date().toISOString();

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('teacher','student')), salt TEXT NOT NULL, password TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS instance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL,
    learning_goal TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '', examples TEXT NOT NULL DEFAULT '[]',
    settings_revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE, name TEXT NOT NULL,
    UNIQUE(course_id, name)
  );
  CREATE TABLE IF NOT EXISTS enrollments (
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id),
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    PRIMARY KEY(course_id, student_id)
  );
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), course_id INTEGER REFERENCES courses(id),
    assignment_id INTEGER, name TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
    sha256 TEXT NOT NULL, text TEXT NOT NULL, content BLOB NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', deadline_at TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','closed')),
    stages TEXT NOT NULL, rules TEXT NOT NULL, alternative_help TEXT NOT NULL DEFAULT '', rubric TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1, version_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assignment_sections (
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    PRIMARY KEY(assignment_id, section_id)
  );
  CREATE TABLE IF NOT EXISTS assignment_versions (
    id INTEGER PRIMARY KEY, assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    snapshot TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_turns (
    id INTEGER PRIMARY KEY, assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id), version_id INTEGER REFERENCES assignment_versions(id),
    client_request_id TEXT NOT NULL, stage TEXT NOT NULL, activity TEXT NOT NULL, prompt TEXT NOT NULL, reply TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'answered', match_type TEXT, created_at TEXT NOT NULL,
    UNIQUE(assignment_id, student_id, client_request_id)
  );
  CREATE TABLE IF NOT EXISTS policy_events (
    id INTEGER PRIMARY KEY, turn_id INTEGER UNIQUE NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
    assignment_id INTEGER NOT NULL, student_id INTEGER NOT NULL, version_id INTEGER,
    match_type TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','confirmed','dismissed')),
    memo TEXT NOT NULL DEFAULT '', reviewed_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drafts (
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', file_id INTEGER REFERENCES files(id),
    items TEXT NOT NULL DEFAULT '[]', objections TEXT NOT NULL DEFAULT '[]', no_ai INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT,
    PRIMARY KEY(assignment_id, student_id)
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY, assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(assignment_id, student_id)
  );
  CREATE TABLE IF NOT EXISTS submission_versions (
    id INTEGER PRIMARY KEY, submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    no INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, items TEXT NOT NULL, system_links TEXT NOT NULL,
    no_ai INTEGER NOT NULL DEFAULT 0, file_id INTEGER REFERENCES files(id), edited_after_upload INTEGER NOT NULL DEFAULT 0,
    assignment_version_id INTEGER, client_request_id TEXT, created_at TEXT NOT NULL,
    UNIQUE(submission_id, no)
  );
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY, submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL, text TEXT NOT NULL, original_text TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('ai_suggested','manual')), anchor TEXT NOT NULL DEFAULT '{}',
    selected INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS evaluations (
    submission_id INTEGER PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
    reason INTEGER CHECK(reason BETWEEN 0 AND 2), transfer INTEGER CHECK(transfer BETWEEN 0 AND 2),
    memo TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS review_flags (
    submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    target TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
    PRIMARY KEY(submission_id, target)
  );
  CREATE INDEX IF NOT EXISTS chat_owner ON chat_turns(assignment_id, student_id);
  CREATE INDEX IF NOT EXISTS enrollment_student ON enrollments(student_id);
`;

// 제출 시 학생의 활용 항목에 연결된 대화 원문을 복사해 고정한다.
export function freezeItems(items, turnsById) {
  return items.map(item => ({
    id: item.id, start: item.start ?? null, end: item.end ?? null, quote: item.quote ?? '', stage: item.stage,
    usage: item.usage, explanation: item.explanation,
    turns: (item.turnIds ?? []).map(id => turnsById.get(id)).filter(Boolean)
      .map(({ id, stage, activity, prompt, reply, action, createdAt }) => ({ id, stage, activity, prompt, reply, action, createdAt })),
  }));
}
export function freezeSystemLinks(body, turns, items, objections) {
  const byId = new Map(turns.map(turn => [turn.id, turn]));
  const reasons = new Map(objections.map(entry => [entry.key, entry.reason]));
  return similarTurns(body, turns, items).map(match => {
    const turn = byId.get(match.turnId);
    return { ...match, prompt: turn.prompt, reply: turn.reply, stage: turn.stage, activity: turn.activity,
      objection: reasons.get(match.key) ?? null };
  });
}

export function openStore(filename, { demo = true, allowDemoAccounts = false } = {}) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  let depth = 0;
  function transaction(work) {
    if (depth) return work();
    db.exec('BEGIN IMMEDIATE');
    depth++;
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      depth--;
    }
  }
  const insert = (sql, ...args) => Number(run(sql, ...args).lastInsertRowid);

  function matchesPassword(user, password) {
    return timingSafeEqual(scryptSync(password, user?.salt ?? 'munyeon-invalid-login', 64),
      user ? Buffer.from(user.password, 'hex') : Buffer.alloc(64));
  }
  function createAccount({ username, name, role, password }) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return insert('INSERT INTO users(username,name,role,salt,password) VALUES(?,?,?,?,?)', username, name, role, salt, hash);
  }

  function snapshotAssignment(id) {
    const assignment = get('SELECT * FROM assignments WHERE id=?', id);
    const course = get('SELECT * FROM courses WHERE id=?', assignment.course_id);
    return {
      title: assignment.title, instructions: assignment.instructions, deadlineAt: assignment.deadline_at,
      stages: JSON.parse(assignment.stages), rules: JSON.parse(assignment.rules), alternativeHelp: assignment.alternative_help,
      rubric: assignment.rubric,
      course: { learningGoal: course.learning_goal, instructions: course.instructions, examples: JSON.parse(course.examples),
        revision: course.settings_revision },
      materials: all('SELECT id,name,body,version FROM materials WHERE course_id=? ORDER BY id', course.id),
    };
  }
  function publishVersion(id) {
    const version = insert('INSERT INTO assignment_versions(assignment_id,snapshot,created_at) VALUES(?,?,?)',
      id, JSON.stringify(snapshotAssignment(id)), now());
    run('UPDATE assignments SET version_id=? WHERE id=?', version, id);
    return version;
  }
  function createAssignment({ courseId, title, instructions = '', deadlineAt = null, status = 'draft', sectionIds = [],
    stages = DEFAULT_STAGE_NAMES, rules = defaultRules(), alternativeHelp = '', rubric = '' }) {
    const stamp = now();
    const id = insert(`INSERT INTO assignments(course_id,title,instructions,deadline_at,status,stages,rules,alternative_help,rubric,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, courseId, title, instructions, deadlineAt, status, JSON.stringify(stages),
    JSON.stringify(rules), alternativeHelp, rubric, stamp, stamp);
    for (const section of sectionIds) run('INSERT INTO assignment_sections VALUES(?,?)', id, section);
    if (status !== 'draft') publishVersion(id);
    return id;
  }

  // 한 과제만 있던 이전 DB를 과목·분반·과제 구조로 옮긴다. 이전 표는 legacy_ 이름으로 남긴다.
  function migrateLegacy() {
    const legacy = ['assignment', 'messages', 'submissions', 'questions', 'evaluations', 'drafts']
      .filter(name => get("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", name));
    if (!legacy.includes('assignment')) return false;
    for (const name of legacy) db.exec(`ALTER TABLE ${name} RENAME TO legacy_${name}`);
    db.exec(schema);
    const teacher = get("SELECT id FROM users WHERE role='teacher' ORDER BY id LIMIT 1");
    if (!teacher) return true;
    const config = normalizeConfig(JSON.parse(get('SELECT config FROM legacy_assignment WHERE id=1').config));
    const course = insert('INSERT INTO courses(owner_id,name,created_at) VALUES(?,?,?)', teacher.id, config.course || '이전 과목', now());
    const section = insert('INSERT INTO sections(course_id,name) VALUES(?,?)', course, config.section || '1분반');
    for (const student of all("SELECT id FROM users WHERE role='student'")) run('INSERT INTO enrollments VALUES(?,?,?)', course, student.id, section);
    const instructions = [config.prompt, config.allowed && '허용하는 도움: ' + config.allowed,
      config.restricted && '제한하는 도움: ' + config.restricted].filter(Boolean).join('\n\n');
    const deadlineAt = config.due ? new Date(config.due + '+09:00').toISOString() : null;
    const assignment = createAssignment({ courseId: course, title: config.title, instructions, deadlineAt, status: 'published',
      sectionIds: [section], rubric: config.rubric });
    const version = get('SELECT version_id FROM assignments WHERE id=?', assignment).version_id;
    if (legacy.includes('messages')) {
      for (const turn of all('SELECT * FROM legacy_messages ORDER BY id')) {
        run(`INSERT INTO chat_turns(assignment_id,student_id,version_id,client_request_id,stage,activity,prompt,reply,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)`, assignment, turn.student_id, version, 'legacy-' + turn.id, 's1',
        legacyModes[turn.mode] ?? 'explain', turn.prompt, turn.reply, now());
      }
    }
    if (legacy.includes('drafts')) {
      for (const draft of all('SELECT * FROM legacy_drafts')) {
        run('INSERT INTO drafts(assignment_id,student_id,title,body,revision,updated_at) VALUES(?,?,?,?,1,?)',
          assignment, draft.student_id, draft.title, draft.body, draft.updated_at);
      }
    }
    if (!legacy.includes('submissions')) return true;
    for (const row of all('SELECT * FROM legacy_submissions ORDER BY id')) {
      const paragraphs = JSON.parse(row.paragraphs);
      const body = paragraphs.join('\n\n');
      const ranges = paragraphRanges(body);
      const evidence = normalizeEvidence(JSON.parse(row.evidence));
      let items = [];
      if (evidence.mode === 'shared') {
        const range = ranges[evidence.paragraph] ?? ranges[0];
        items = [{ id: 'legacy', start: range?.start ?? null, end: range?.end ?? null, quote: range?.text ?? '', stage: 's1',
          usage: 'reworked', explanation: evidence.explanation ?? '',
          turns: [{ id: null, stage: 's1', activity: 'explain', prompt: evidence.question ?? '', reply: evidence.excerpt ?? '', action: 'answered', legacy: true }] }];
      } else if (evidence.mode === 'manual') {
        items = [{ id: 'legacy', start: null, end: null, quote: '', stage: 's1', usage: 'idea', explanation: evidence.explanation ?? '', turns: [] }];
      }
      const submission = insert('INSERT INTO submissions(assignment_id,student_id,created_at,updated_at) VALUES(?,?,?,?)',
        assignment, row.student_id, row.created_at, row.created_at);
      run(`INSERT INTO submission_versions(submission_id,no,title,body,items,system_links,no_ai,assignment_version_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`, submission, 1, row.title, body, JSON.stringify(items), '[]', evidence.mode === 'none' ? 1 : 0,
      version, row.created_at);
      const evaluation = legacy.includes('evaluations') ? get('SELECT * FROM legacy_evaluations WHERE submission_id=?', row.id) : null;
      if (legacy.includes('questions')) {
        for (const question of all('SELECT * FROM legacy_questions WHERE submission_id=? ORDER BY id', row.id)) {
          const range = ranges[question.paragraph];
          run(`INSERT INTO questions(submission_id,version_no,text,original_text,source,anchor,selected,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?)`, submission, 1, question.text, question.text, question.source === 'AI 추천' ? 'ai_suggested' : 'manual',
          JSON.stringify(range ? { start: range.start, end: range.end, quote: range.text } : {}),
          evaluation?.question_id === question.id ? 1 : 0, row.created_at, row.created_at);
        }
      }
      if (evaluation && evaluation.reason != null) {
        run('INSERT INTO evaluations VALUES(?,?,?,?,?)', submission, evaluation.reason, evaluation.transfer, evaluation.memo, now());
      }
    }
    return true;
  }

  function seedDemo() {
    const ids = Object.fromEntries(demoAccounts.map(account =>
      [account.username, get('SELECT id FROM users WHERE username=?', account.username)?.id ?? createAccount(account)]));
    const stamp = now();
    const course = insert(`INSERT INTO courses(owner_id,name,learning_goal,instructions,examples,created_at) VALUES(?,?,?,?,?,?)`,
      ids.teacher, '창의융합적디자인', '사용자 관찰에서 문제를 정의하고, 검증 가능한 해결안을 제안한다.',
      '정답을 대신 쓰지 말고 학생이 스스로 판단할 수 있도록 질문과 근거 찾는 방법을 안내한다.',
      JSON.stringify([{ question: '문제 정의를 어떻게 시작해야 할까요?', answer: '사용자가 실제로 겪는 불편을 관찰하고, 그 장면을 근거로 문제를 한 문장으로 적어 보세요.' }]), stamp);
    const first = insert('INSERT INTO sections(course_id,name) VALUES(?,?)', course, '01분반');
    const second = insert('INSERT INTO sections(course_id,name) VALUES(?,?)', course, '02분반');
    run('INSERT INTO enrollments VALUES(?,?,?)', course, ids.student, first);
    run('INSERT INTO enrollments VALUES(?,?,?)', course, ids.student2, first);
    run('INSERT INTO enrollments VALUES(?,?,?)', course, ids.student3, second);
    run('INSERT INTO materials(course_id,name,body,updated_at) VALUES(?,?,?,?)', course, '3주차 강의자료 · 사용성 평가',
      '사용성 평가는 같은 과제를 서로 다른 화면에서 수행하게 하고 완료 시간과 오류 횟수를 비교한다.\n\n참가자에게 화면 순서를 바꿔 제시하면 학습 효과를 줄일 수 있다.', stamp);
    const deadlineAt = new Date(Date.now() + 7 * 86400_000).toISOString();
    const assignment = createAssignment({ courseId: course, title: '디자인 문제 해결 보고서', status: 'published', deadlineAt,
      sectionIds: [first, second], alternativeHelp: '문단을 대신 쓰는 대신, 핵심 주장과 근거를 스스로 정리할 수 있도록 질문을 드릴게요.',
      instructions: '캠퍼스에서 관찰한 불편 하나를 골라 문제를 정의하고, 해결안과 검토 계획을 제안하세요. 4~6문단, 관찰 근거를 포함합니다.',
      rubric: '선택의 근거와 조건이 달라질 때의 판단을 각각 0~2점으로 평가한다.' });
    const version = get('SELECT version_id FROM assignments WHERE id=?', assignment).version_id;
    const turn = (student, request, stage, activity, prompt, reply, action = 'answered', matchType = null) =>
      insert(`INSERT INTO chat_turns(assignment_id,student_id,version_id,client_request_id,stage,activity,prompt,reply,action,match_type,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`, assignment, student, version, request, stage, activity, prompt, reply, action, matchType, stamp);
    const t1 = turn(ids.student, 'seed-1', 's1', 'ideas', '도서관 좌석 예약 화면의 문제를 어떻게 정의하면 좋을까?',
      '사용자가 실제로 겪는 불편을 관찰 근거와 함께 적어 보세요. 예를 들어 빈자리를 찾는 데 걸리는 시간이나 화면을 오가는 횟수를 기록하면 문제를 구체적으로 정의할 수 있어요.');
    const t2 = turn(ids.student, 'seed-2', 's3', 'feedback', '검토 계획을 어떻게 세우면 좋을까?',
      '두 화면에서 같은 과제를 수행하게 하고 걸린 시간을 비교해 보세요. 참가자 8명에게 두 화면을 순서를 바꿔 제시해 학습 효과를 줄일 수 있어요. 만족도를 1~5점 유사도 점수로 함께 받는 방법도 있어요.');
    const t3 = turn(ids.student, 'seed-3', 's3', 'write', '해결 제안 문단을 대신 써 줘.',
      '이 단계에서 문장 대신 작성은 제한된 도움이에요. 문단을 대신 쓰는 대신, 핵심 주장과 근거를 스스로 정리할 수 있도록 질문을 드릴게요. 지금 제안하려는 해결안은 관찰한 불편 중 무엇을 줄이나요?',
      'restricted', 'explicit_restriction');
    run('INSERT INTO policy_events(turn_id,assignment_id,student_id,version_id,match_type,action,created_at) VALUES(?,?,?,?,?,?,?)',
      t3, assignment, ids.student, version, 'explicit_restriction', 'hint', stamp);
    const body = [
      '문제 정의: 학교 도서관 좌석 예약 화면에서 학생들이 빈자리를 찾는 데 시간이 오래 걸린다. 현장 관찰 결과 학생 10명 중 7명이 층별 지도를 두 번 이상 오갔다.',
      "해결 제안: 층별 지도 대신 '지금 바로 앉을 수 있는 좌석'을 목록 맨 위에 보여주고, 콘센트와 창가 같은 조건을 필터로 고르게 한다.",
      '검토 계획: 기존 화면과 새 화면에서 같은 조건의 좌석을 찾는 데 걸린 시간을 비교한다. 참가자 8명에게 두 화면을 순서를 바꿔 제시해 학습 효과를 줄인다.',
      '한계: 시험 기간처럼 좌석이 거의 없는 상황에서는 목록이 비어 보일 수 있어, 예상 대기 시간을 함께 안내하는 방안을 추가로 검토해야 한다.',
    ].join('\n\n');
    const span = text => ({ start: body.indexOf(text), end: body.indexOf(text) + text.length, quote: text });
    const items = [
      { id: 'seed-a', ...span('현장 관찰 결과 학생 10명 중 7명이 층별 지도를 두 번 이상 오갔다.'), turnIds: [t1], stage: 's1', usage: 'idea',
        explanation: '관찰 근거를 넣으라는 조언을 참고해 직접 도서관에서 학생 10명을 관찰했어요.' },
      { id: 'seed-b', ...span('기존 화면과 새 화면에서 같은 조건의 좌석을 찾는 데 걸린 시간을 비교한다.'), turnIds: [t2], stage: 's3', usage: 'reworked',
        explanation: '두 화면에서 같은 항목을 찾는 데 걸린 시간을 비교하도록 바꿨어요.' },
      { id: 'seed-c', start: null, end: null, quote: '', turnIds: [t2], stage: 's3', usage: 'not_adopted',
        explanation: '만족도 유사도 점수는 응답자마다 기준이 달라 비교 근거로 약하다고 판단해 넣지 않았어요.' },
    ];
    const turns = all('SELECT id,stage,activity,prompt,reply,action,created_at AS createdAt FROM chat_turns WHERE assignment_id=? AND student_id=?', assignment, ids.student);
    const submitted = (student, title, text, list, linkTurns, noAi = 0) => {
      const id = insert('INSERT INTO submissions(assignment_id,student_id,created_at,updated_at) VALUES(?,?,?,?)', assignment, student, stamp, stamp);
      run(`INSERT INTO submission_versions(submission_id,no,title,body,items,system_links,no_ai,assignment_version_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`, id, 1, title, text, JSON.stringify(freezeItems(list, new Map(linkTurns.map(entry => [entry.id, entry])))),
      JSON.stringify(freezeSystemLinks(text, linkTurns.filter(entry => entry.action === 'answered'), list, [])), noAi, version, stamp);
      run('INSERT INTO drafts(assignment_id,student_id,title,body,items,no_ai,revision,updated_at) VALUES(?,?,?,?,?,?,1,?)',
        assignment, student, title, text, JSON.stringify(list.map(item => ({ ...item, status: item.start == null ? 'unanchored' : 'ok' }))), noAi, stamp);
    };
    submitted(ids.student, '도서관 좌석 찾기 문제 해결 보고서', body, items, turns);
    const other = '문제 정의: 학생식당 키오스크에서 메뉴를 고르는 데 평균 40초가 걸려 점심시간 대기 줄이 길어진다.\n\n해결 제안: 자주 고르는 메뉴 세 가지를 첫 화면에 크게 보여주고, 결제 단계를 한 화면으로 줄인다.\n\n검토 계획: 점심시간 30분 동안 주문 완료 시간을 기록해 변경 전후를 비교한다.';
    submitted(ids.student2, '학생식당 키오스크 주문 시간 줄이기', other, [{ id: 'seed-d', start: null, end: null, quote: '', turnIds: [],
      stage: 's4', usage: 'idea', explanation: '다른 AI 도구로 보고서 문장의 맞춤법만 확인했어요.' }], []);
    run('INSERT INTO drafts(assignment_id,student_id,title,body,revision,updated_at) VALUES(?,?,?,?,1,?)', assignment, ids.student3,
      '', '', stamp);

    const research = insert('INSERT INTO courses(owner_id,name,created_at) VALUES(?,?,?)', ids.teacher2, '디자인 리서치 방법', stamp);
    const researchSection = insert('INSERT INTO sections(course_id,name) VALUES(?,?)', research, '01분반');
    run('INSERT INTO enrollments VALUES(?,?,?)', research, ids.student, researchSection);
    createAssignment({ courseId: research, title: '사용자 인터뷰 계획서', status: 'published', sectionIds: [researchSection],
      deadlineAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
      instructions: '인터뷰 대상, 질문 목록, 기록 방법을 포함한 계획서를 작성하세요.', rubric: '질문 설계의 근거를 평가한다.' });
  }

  try {
    transaction(() => {
      const version = get('PRAGMA user_version').user_version;
      if (version < SCHEMA_VERSION) {
        if (!migrateLegacy()) db.exec(schema);
        db.exec('PRAGMA user_version = ' + SCHEMA_VERSION);
      }
      db.exec(schema);
      if (demo && !get("SELECT 1 FROM instance_settings WHERE key='production'")) {
        if (!get('SELECT 1 FROM courses')) seedDemo();
        for (const account of demoAccounts) {
          if (!get('SELECT id FROM users WHERE username=?', account.username)) createAccount(account);
        }
      }
      if (!demo && !allowDemoAccounts) {
        for (const account of demoAccounts) {
          const user = get('SELECT salt,password FROM users WHERE username=?', account.username);
          if (user && matchesPassword(user, account.password)) {
            throw new Error('체험 계정이 포함된 DB입니다. 새 운영 DB를 지정하거나 체험 계정의 비밀번호를 먼저 교체하세요.');
          }
        }
        const transition = run("INSERT OR IGNORE INTO instance_settings VALUES ('production','1')");
        if (transition.changes) run('DELETE FROM sessions');
      }
    });
  } catch (error) {
    db.close();
    throw error;
  }

  function resetPassword(username, password) {
    return transaction(() => {
      const user = get('SELECT id FROM users WHERE username=?', username);
      if (!user) return false;
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(password, salt, 64).toString('hex');
      run('UPDATE users SET salt=?,password=? WHERE id=?', salt, hash, user.id);
      run('DELETE FROM sessions WHERE user_id=?', user.id);
      return true;
    });
  }
  function takeLimit(key, max, duration, at = Date.now()) {
    const result = run(`INSERT INTO rate_limits VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
      expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END
      WHERE expires<=? OR count<?`, key, at + duration, at, at, at, max);
    return result.changes > 0;
  }
  function signIn(username, password) {
    const user = get('SELECT * FROM users WHERE username=?', username);
    if (!matchesPassword(user, password) || !user) return;
    const token = randomBytes(32).toString('hex');
    run('DELETE FROM sessions WHERE expires <= ?', Date.now());
    run('INSERT INTO sessions VALUES (?,?,?)', digest(token), user.id, Date.now() + 8 * 3600_000);
    return token;
  }
  function userFor(token) {
    if (!token) return;
    return get(`SELECT users.id, users.username, users.name, users.role FROM sessions
      JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>?`, digest(token), Date.now());
  }

  return { db, get, all, run, insert, transaction, signIn, userFor, createAccount, resetPassword, takeLimit, publishVersion,
    createAssignment, signOut: token => token && run('DELETE FROM sessions WHERE token=?', digest(token)) };
}
