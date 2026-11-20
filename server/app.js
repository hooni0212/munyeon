import { createModel } from './model.js';
import { modes, openStore, splitParagraphs } from './store.js';

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function input(value, label, max, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) {
    fail(400, label + '을(를) 확인해 주세요.');
  }
  return value.trim();
}

function number(value, max) {
  if (!Number.isInteger(value) || value < 0 || value > max) fail(400, '선택한 값을 확인해 주세요.');
  return value;
}

const configLimits = { title: 160, course: 160, section: 60, due: 16, prompt: 1600, allowed: 500, restricted: 500, rubric: 1600 };
const optionalConfig = new Set(['section', 'due', 'allowed', 'restricted']);
const reportModes = ['', 'shared', 'manual', 'none'];

function draftReport(value) {
  const report = value && typeof value === 'object' ? value : {};
  if (!reportModes.includes(report.mode ?? '')) fail(400, 'AI 활용 방식을 확인해 주세요.');
  return {
    mode: report.mode ?? '',
    messageId: report.messageId == null ? null : number(report.messageId, Number.MAX_SAFE_INTEGER),
    paragraph: number(report.paragraph ?? 0, 1000),
    explanation: input(report.explanation, '활용 설명', 1600, true),
    manualExplanation: input(report.manualExplanation, '활용 설명', 1600, true),
  };
}

export function createApp({ database, model = createModel(), origin = null, aiDailyLimit = 120 }) {
  const store = openStore(database, { demo: !origin });
  const cookieName = origin ? '__Host-munyeon' : 'munyeon';
  const cookie = token => cookieName + '=' + (token || '') + '; Path=/; HttpOnly; SameSite=Strict' +
    (origin ? '; Secure' : '') + '; Max-Age=' + (token ? '28800' : '0');
  const routes = [];
  const route = (method, path, role, handle) => routes.push({ method, path, role, handle });
  const tokenPattern = new RegExp('(?:^|;\\s*)' + cookieName + '=([a-f0-9]{64})(?:;|$)');
  const tokenFor = request => request.headers.get('cookie')?.match(tokenPattern)?.[1];
  const submissionFor = id => {
    const result = store.submission(Number(id));
    if (!result) fail(404, '제출물을 찾을 수 없어요.');
    return result;
  };

  route('GET', /^\/api\/session$/, null, ({ user }) => ({ user: user ?? null, model: model.label, demo: !origin }));
  route('POST', /^\/api\/login$/, null, ({ body, token, ip }) => {
    const username = input(body.username, '아이디', 60);
    const password = input(body.password, '비밀번호', 128);
    if (origin) {
      store.run('DELETE FROM rate_limits WHERE expires<=?', Date.now());
      if (!store.takeLimit('login:ip:' + ip, 60, 15 * 60_000) ||
          !store.takeLimit('login:pair:' + ip + ':' + username.toLowerCase(), 8, 15 * 60_000)) {
        fail(429, '로그인 시도가 많아요. 잠시 뒤 다시 시도해 주세요.');
      }
    }
    const session = store.signIn(username, password);
    if (!session) fail(401, '아이디와 비밀번호를 확인해 주세요.');
    store.signOut(token);
    return Response.json({ user: store.userFor(session), model: model.label, demo: !origin }, {
      headers: { 'Set-Cookie': cookie(session), 'Cache-Control': 'no-store' },
    });
  });
  route('POST', /^\/api\/logout$/, null, ({ token }) => {
    store.signOut(token);
    return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(null) } });
  });
  function reserveModelCall(user) {
    if (!origin || !model.enabled) return;
    store.transaction(() => {
      if (!store.takeLimit('ai:user:' + user.id, 20, 60 * 60_000) ||
          !store.takeLimit('ai:instance', aiDailyLimit, 24 * 60 * 60_000)) {
        fail(429, 'AI 사용 한도에 도달했어요. 잠시 뒤 다시 시도해 주세요.');
      }
    });
  }
  route('GET', /^\/api\/assignment$/, 'member', () => store.assignment());
  route('PUT', /^\/api\/assignment$/, 'teacher', ({ body }) => {
    const config = Object.fromEntries(Object.entries(configLimits).map(([key, max]) =>
      [key, input(body[key], key, max, optionalConfig.has(key))]));
    if (config.due && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(config.due)) fail(400, '제출 마감을 확인해 주세요.');
    store.run('UPDATE assignment SET config=? WHERE id=1', JSON.stringify(config));
    return config;
  });

  route('GET', /^\/api\/learning$/, 'student', ({ user }) =>
    store.all('SELECT id,mode,prompt,reply FROM messages WHERE student_id=? ORDER BY id', user.id));
  route('POST', /^\/api\/learning$/, 'student', async ({ user, body }) => {
    const mode = body.mode;
    if (!Object.hasOwn(modes, mode)) fail(400, '도움 유형을 선택해 주세요.');
    const prompt = input(body.prompt, '질문', 3000);
    const history = store.all('SELECT mode,prompt,reply FROM messages WHERE student_id=? ORDER BY id DESC LIMIT 8', user.id).reverse();
    reserveModelCall(user);
    const reply = await model.tutor(store.assignment(), mode, prompt, history);
    const record = store.run('INSERT INTO messages(student_id,mode,prompt,reply) VALUES(?,?,?,?)', user.id, mode, prompt, reply);
    return { id: Number(record.lastInsertRowid), mode, prompt, reply };
  });

  const ownSubmission = user => {
    const row = store.get('SELECT id FROM submissions WHERE student_id=?', user.id);
    if (!row) return null;
    const { id, title, createdAt, paragraphs, evidence } = store.submission(row.id);
    return { id, title, createdAt, paragraphs, evidence };
  };
  route('GET', /^\/api\/submission$/, 'student', ({ user }) => ({ submission: ownSubmission(user) }));
  route('POST', /^\/api\/submission$/, 'student', ({ user, body }) => {
    const title = input(body.title, '제목', 160);
    const paragraphs = splitParagraphs(input(body.text, '본문', 16000));
    const report = draftReport(body.report);
    let evidence;
    if (report.mode === 'none') evidence = { mode: 'none' };
    else if (report.mode === 'manual') evidence = { mode: 'manual', explanation: input(report.manualExplanation, '활용 설명', 1600) };
    else if (report.mode === 'shared') {
      const turn = report.messageId && store.get('SELECT prompt,reply FROM messages WHERE id=? AND student_id=?', report.messageId, user.id);
      if (!turn) fail(400, '연결할 대화를 확인해 주세요.');
      evidence = { mode: 'shared', paragraph: number(report.paragraph, paragraphs.length - 1),
        explanation: input(report.explanation, '활용 설명', 1600), question: turn.prompt, excerpt: turn.reply };
    } else fail(400, 'AI 활용 방식을 선택해 주세요.');
    const usedModes = store.all('SELECT DISTINCT mode FROM messages WHERE student_id=?', user.id).map(row => row.mode);
    store.transaction(() => {
      if (store.get('SELECT id FROM submissions WHERE student_id=?', user.id)) fail(409, '이미 제출한 과제예요.');
      store.run('INSERT INTO submissions(student_id,title,paragraphs,evidence,modes,config,created_at) VALUES(?,?,?,?,?,?,?)',
        user.id, title, JSON.stringify(paragraphs), JSON.stringify(evidence), JSON.stringify(usedModes),
        JSON.stringify(store.assignment()), new Date().toISOString());
      store.run('DELETE FROM drafts WHERE student_id=?', user.id);
    });
    return { submission: ownSubmission(user) };
  });

  route('GET', /^\/api\/draft$/, 'student', ({ user }) => {
    const row = store.get('SELECT title,body,report,updated_at AS updatedAt FROM drafts WHERE student_id=?', user.id);
    return row ? { ...row, report: JSON.parse(row.report) } : { title: '', body: '', report: draftReport({}), updatedAt: null };
  });
  route('PUT', /^\/api\/draft$/, 'student', ({ user, body }) => {
    const title = input(body.title, '제목', 160, true);
    const text = input(body.body, '본문', 16000, true) === '' ? '' : body.body;
    const report = draftReport(body.report);
    const updatedAt = new Date().toISOString();
    store.transaction(() => {
      if (store.get('SELECT id FROM submissions WHERE student_id=?', user.id)) fail(409, '이미 제출한 과제예요.');
      store.run(`INSERT INTO drafts VALUES (?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET
        title=excluded.title, body=excluded.body, report=excluded.report, updated_at=excluded.updated_at`,
      user.id, title, text, JSON.stringify(report), updatedAt);
    });
    return { updatedAt };
  });

  route('GET', /^\/api\/roster$/, 'teacher', () => store.all(`
    SELECT users.id AS studentId, users.name, submissions.id, submissions.title, submissions.created_at AS createdAt,
      CASE WHEN submissions.id IS NULL THEN '미제출'
           WHEN evaluations.reason IS NOT NULL THEN '평가 완료'
           WHEN evaluations.question_id IS NOT NULL THEN '질문 준비 완료'
           ELSE '검토 대기' END AS status
    FROM users LEFT JOIN submissions ON submissions.student_id=users.id
    LEFT JOIN evaluations ON evaluations.submission_id=submissions.id
    WHERE users.role='student' ORDER BY submissions.id IS NULL, submissions.id, users.name`));
  route('GET', /^\/api\/submissions\/(\d+)$/, 'teacher', ({ params }) => submissionFor(params[0]));
  route('POST', /^\/api\/submissions\/(\d+)\/suggest$/, 'teacher', async ({ params, user }) => {
    const submission = submissionFor(params[0]);
    reserveModelCall(user);
    const candidates = await model.suggest(submission);
    return store.transaction(() => {
      for (const candidate of candidates) {
        if (!store.get('SELECT id FROM questions WHERE submission_id=? AND paragraph=? AND text=?',
          submission.id, candidate.paragraph, candidate.text)) {
          store.run('INSERT INTO questions(submission_id,paragraph,text,source) VALUES(?,?,?,?)',
            submission.id, candidate.paragraph, candidate.text, 'AI 추천');
        }
      }
      return submissionFor(submission.id);
    });
  });
  route('PUT', /^\/api\/submissions\/(\d+)\/question$/, 'teacher', ({ params, body }) => {
    const text = input(body.text, '질문', 1200);
    return store.transaction(() => {
      const submission = submissionFor(params[0]);
      const paragraph = number(body.paragraph, submission.paragraphs.length - 1);
      const current = submission.questions.find(item => item.id === submission.evaluation?.questionId);
      if (!current) {
        const result = store.run('INSERT INTO questions(submission_id,paragraph,text,source) VALUES(?,?,?,?)',
          submission.id, paragraph, text, '직접 작성');
        store.run('INSERT INTO evaluations(submission_id,question_id) VALUES(?,?)', submission.id, Number(result.lastInsertRowid));
      } else if (current.text !== text || current.paragraph !== paragraph) {
        store.run('UPDATE questions SET text=?, paragraph=? WHERE id=?', text, paragraph, current.id);
        store.run('UPDATE evaluations SET reason=NULL, transfer=NULL, memo=\'\' WHERE submission_id=?', submission.id);
      }
      return submissionFor(submission.id);
    });
  });
  route('PUT', /^\/api\/submissions\/(\d+)\/evaluation$/, 'teacher', ({ params, body }) => {
    const reason = number(body.reason, 2);
    const transfer = number(body.transfer, 2);
    const memo = input(body.memo, '평가 메모', 3000, true);
    return store.transaction(() => {
      const submission = submissionFor(params[0]);
      const question = submission.questions.find(item => item.id === body.questionId);
      if (submission.evaluation?.questionId !== body.questionId || !question || question.text !== body.questionText) {
        fail(409, '확정 질문이 바뀌었어요. 질문을 다시 확인해 주세요.');
      }
      store.run('UPDATE evaluations SET reason=?,transfer=?,memo=? WHERE submission_id=?', reason, transfer, memo, submission.id);
      return submissionFor(submission.id);
    });
  });

  async function handle(request, { ip = 'local' } = {}) {
    try {
      const path = new URL(request.url).pathname;
      const entry = routes.find(item => item.method === request.method && item.path.test(path));
      if (!entry) fail(404, '요청한 기능을 찾을 수 없어요.');
      const token = tokenFor(request);
      const user = store.userFor(token);
      if (entry.role && !user) fail(401, '로그인이 필요해요.');
      if (entry.role && entry.role !== 'member' && user.role !== entry.role) fail(403, '이 화면에 접근할 권한이 없어요.');
      let body = {};
      if (!['GET', 'HEAD'].includes(request.method)) {
        if (request.headers.get('sec-fetch-site') === 'cross-site') fail(403, '같은 사이트에서 다시 시도해 주세요.');
        if (origin && request.headers.get('origin') !== origin) fail(403, '서비스 주소에서 다시 시도해 주세요.');
        if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'JSON 요청이 필요해요.');
        try { body = await request.json(); } catch { fail(400, '요청 형식을 확인해 주세요.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '요청 형식을 확인해 주세요.');
      }
      const result = await entry.handle({ user, token, body, ip, params: path.match(entry.path).slice(1) });
      return result instanceof Response ? result : Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (!error.status) console.error(error);
      return Response.json({ error: error.status ? error.message : '서버에서 요청을 처리하지 못했어요.' }, {
        status: error.status ?? 500, headers: { 'Cache-Control': 'no-store' },
      });
    }
  }
  return { handle, ready: () => store.get("SELECT 1 FROM users WHERE role='teacher'") !== undefined, close: () => store.db.close() };
}
