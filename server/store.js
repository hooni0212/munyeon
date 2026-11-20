import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export const modes = { concept: '개념 설명', hint: '힌트', feedback: '초안 피드백' };
export const defaults = {
  title: '대표값과 분포', course: '통계와 데이터', section: '', due: '',
  prompt: '표본 분포를 보고 적절한 대표값을 선택하고 그 이유를 설명하세요. 표본 데이터와 대표값 강의자료를 참고합니다.',
  allowed: '개념 설명, 계산 확인, 해석 초안 피드백',
  restricted: '대표값 선택과 최종 해석 대신 작성',
  rubric: '선택의 근거와 조건 변화의 영향을 각각 0~2점으로 평가한다.',
};

// 이전 버전의 과제 설정(goal·materials·help·independent)을 현재 항목으로 옮긴다.
export function normalizeConfig(config = {}) {
  if (typeof config.prompt === 'string') return { ...defaults, ...config };
  const prompt = [config.goal, config.materials && '참고 자료: ' + config.materials].filter(Boolean).join('\n');
  return {
    ...defaults, title: config.title ?? defaults.title, course: config.course ?? defaults.course,
    prompt: prompt || defaults.prompt, allowed: config.help ?? defaults.allowed,
    restricted: config.independent ? '직접 할 부분: ' + config.independent : defaults.restricted,
    rubric: config.rubric ?? defaults.rubric,
  };
}

// 이전 버전의 근거 기록을 AI 활용 보고 형식으로 옮긴다.
export function normalizeEvidence(evidence) {
  if (!evidence) return { mode: 'unreported' };
  if (evidence.mode) return evidence;
  if (evidence.source === '문연 학습실') {
    return { mode: 'shared', paragraph: evidence.paragraph, explanation: evidence.explanation, question: '', excerpt: evidence.excerpt };
  }
  return { mode: 'manual', explanation: evidence.explanation };
}

export function splitParagraphs(text) {
  return text.trim().split(/\n[ \t]*\n+/).map(part => part.trim()).filter(Boolean);
}
export const demoAccounts = [
  { username: 'teacher', name: '김교수', role: 'teacher', password: 'munyeon-teacher' },
  { username: 'student', name: '이서윤', role: 'student', password: 'munyeon-student' },
  { username: 'student2', name: '박지우', role: 'student', password: 'munyeon-student2' },
];

const digest = token => createHash('sha256').update(token).digest('hex');

export function openStore(filename, { demo = true, allowDemoAccounts = false } = {}) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('teacher','student')), salt TEXT NOT NULL, password TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assignment (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id),
      mode TEXT NOT NULL, prompt TEXT NOT NULL, reply TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY, student_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      title TEXT NOT NULL, paragraphs TEXT NOT NULL, evidence TEXT NOT NULL,
      modes TEXT NOT NULL, config TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY, submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      paragraph INTEGER NOT NULL CHECK(paragraph >= 0), text TEXT NOT NULL, source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evaluations (
      submission_id INTEGER PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id),
      reason INTEGER CHECK(reason BETWEEN 0 AND 2), transfer INTEGER CHECK(transfer BETWEEN 0 AND 2),
      memo TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS drafts (
      student_id INTEGER PRIMARY KEY REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL,
      report TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL
    );
  `);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  try {
    transaction(() => {
      run('INSERT OR IGNORE INTO assignment VALUES (1, ?)', JSON.stringify(defaults));
      const stored = JSON.parse(get('SELECT config FROM assignment WHERE id=1').config);
      if (typeof stored.prompt !== 'string') run('UPDATE assignment SET config=? WHERE id=1', JSON.stringify(normalizeConfig(stored)));
      run('CREATE TABLE IF NOT EXISTS instance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      if (demo && !get("SELECT 1 FROM instance_settings WHERE key='production'")) {
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

  function matchesPassword(user, password) {
    return timingSafeEqual(scryptSync(password, user?.salt ?? 'munyeon-invalid-login', 64),
      user ? Buffer.from(user.password, 'hex') : Buffer.alloc(64));
  }

  function createAccount({ username, name, role, password }) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    run('INSERT INTO users(username,name,role,salt,password) VALUES(?,?,?,?,?)', username, name, role, salt, hash);
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

  function takeLimit(key, max, duration, now = Date.now()) {
    const result = run(`INSERT INTO rate_limits VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
      expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END
      WHERE expires<=? OR count<?`, key, now + duration, now, now, now, max);
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

  function submission(id) {
    const row = get(`SELECT submissions.*, users.name FROM submissions
      JOIN users ON users.id=submissions.student_id WHERE submissions.id=?`, id);
    if (!row) return;
    return {
      id: row.id, name: row.name, title: row.title, createdAt: row.created_at,
      paragraphs: JSON.parse(row.paragraphs), evidence: normalizeEvidence(JSON.parse(row.evidence)),
      modes: JSON.parse(row.modes), config: normalizeConfig(JSON.parse(row.config)),
      questions: all('SELECT id,paragraph,text,source FROM questions WHERE submission_id=? ORDER BY id', id),
      evaluation: get('SELECT question_id AS questionId,reason,transfer,memo FROM evaluations WHERE submission_id=?', id) ?? null,
    };
  }

  return { db, get, all, run, transaction, signIn, userFor, submission, createAccount, resetPassword, takeLimit,
    signOut: token => token && run('DELETE FROM sessions WHERE token=?', digest(token)),
    assignment: () => normalizeConfig(JSON.parse(get('SELECT config FROM assignment WHERE id=1').config)),
  };
}
