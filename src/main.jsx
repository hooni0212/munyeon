import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import './style.css';

const modes = { concept: '개념 설명', hint: '힌트', feedback: '초안 피드백' };
const labels = {
  title: '과제 제목', course: '과목', goal: '학습목표', materials: '참고 자료',
  help: '허용하는 도움', independent: '학생이 직접 할 부분', rubric: '구술평가 기준',
};

function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  async function run(work) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await work(text => setMessage({ text }));
    } catch (error) {
      setMessage({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }
  return { busy, run, message };
}

function Notice({ message }) {
  return message && <p className={'notice' + (message.error ? ' error' : '')}
    role={message.error ? 'alert' : 'status'}>{message.text}</p>;
}

function Panel({ title, aside, children, className = '' }) {
  return <section className={'panel ' + className}>
    {title && <header className="panel-head"><h2>{title}</h2>{aside}</header>}
    {children}
  </section>;
}

function Heading({ title, subtitle, action }) {
  return <header className="heading"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</header>;
}

function Login({ onLogin, demo }) {
  const { busy, run, message } = useAction();
  function login(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    run(async () => onLogin(await api('/login', 'POST', values)));
  }
  return <main className="login-page">
    <div className="login-box">
      <div className="wordmark">문연<span className="wordmark-dot">.</span></div>
      <Heading title="로그인" subtitle="과제 학습과 구술평가" />
      <form className="login-form" onSubmit={login}>
        <label>아이디<input name="username" autoComplete="username" required maxLength={60} /></label>
        <label>비밀번호<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
        <Notice message={message} />
        <button className="primary" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
      </form>
      {demo && <details className="account-help"><summary>로컬 체험 계정</summary>
        <dl><dt>교수자</dt><dd><code>teacher</code> / <code>munyeon-teacher</code></dd>
          <dt>학생</dt><dd><code>student</code> / <code>munyeon-student</code></dd>
          <dt>학생 2</dt><dd><code>student2</code> / <code>munyeon-student2</code></dd></dl>
      </details>}
    </div>
  </main>;
}

function Guidance({ config }) {
  return <dl className="details">{['goal', 'materials', 'help', 'independent', 'rubric'].map(key =>
    <div key={key}><dt>{labels[key]}</dt><dd>{config[key] || '지정 없음'}</dd></div>)}</dl>;
}

function Setup({ config, onSave }) {
  const { busy, run, message } = useAction();
  function save(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    run(async notice => {
      onSave(await api('/assignment', 'PUT', values));
      notice('과제 지침을 저장했어요.');
    });
  }
  return <>
    <Heading title="과제 설정" subtitle="학생의 학습과 구술평가에 적용할 과제 지침을 설정하세요." />
    <div className="split">
      <Panel title="과제 지침">
        <form className="fields panel-body" onSubmit={save}>
          {Object.entries(labels).map(([key, label]) =>
            <label key={key}>{label}
              {['title', 'course'].includes(key)
                ? <input name={key} defaultValue={config[key]} required maxLength={1600} />
                : <textarea name={key} defaultValue={config[key]} rows={2} required={key !== 'materials'} maxLength={1600} />}
            </label>)}
          <Notice message={message} />
          <div className="actions"><button className="primary" disabled={busy}>지침 저장</button></div>
        </form>
      </Panel>
      <Panel title="학생에게 표시되는 내용"><div className="panel-body"><Guidance config={config} /></div></Panel>
    </div>
  </>;
}

const starters = [
  { mode: 'concept', title: '개념 이해하기', prompt: '이 과제의 학습목표를 이해하는 데 필요한 개념을 예시와 함께 설명해 줘.' },
  { mode: 'hint', title: '풀이 힌트 받기', prompt: '이 과제를 어디서 시작하면 좋을지 힌트를 하나 줘.' },
  { mode: 'feedback', title: '초안 검토하기', prompt: '과제 지침에 따라 내 초안의 근거와 논리 흐름을 검토해 줘.\n\n' },
];

function Learn({ config, model, turns, setTurns, selected, onShare, onSubmitPage, active }) {
  const { busy, run, message } = useAction();
  const [mode, setMode] = useState('concept');
  const [prompt, setPrompt] = useState('');
  const [pending, setPending] = useState(null);
  const inputRef = useRef(null);
  const formRef = useRef(null);
  const latestRef = useRef(null);
  const hasConversation = turns.length > 0 || pending !== null;

  useEffect(() => {
    if (active && hasConversation) latestRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active, turns.length, pending, hasConversation]);

  function send(event) {
    event.preventDefault();
    const question = prompt.trim();
    if (!model || !question || busy) return;
    run(async () => {
      setPending(question);
      try {
        const turn = await api('/learning', 'POST', { mode, prompt: question });
        setTurns(previous => [...previous, turn]);
        setPrompt('');
      } finally {
        setPending(null);
      }
    });
  }

  function startWith(starter) {
    setMode(starter.mode);
    setPrompt(starter.prompt);
    inputRef.current.focus();
  }

  function handleKey(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    formRef.current.requestSubmit();
  }

  return <section className="study" hidden={!active} aria-label="AI 학습실">
    <header className="study-header">
      <div className="study-context"><strong>AI 학습실</strong><span>{config.title}</span></div>
      <div className="study-controls">
        <details className="study-guide"><summary>과제 지침</summary>
          <div className="study-guide-content"><Guidance config={config} /></div>
        </details>
        <button className="secondary" onClick={onSubmitPage}>과제 제출 <span aria-hidden="true">↗</span></button>
      </div>
    </header>

    {hasConversation && <div className="study-thread study-width" role="log" aria-label="학습 대화">
      {turns.map(turn => <article className="study-turn" key={turn.id}>
        <p className="study-user" aria-label="내 질문">{turn.prompt}</p>
        <div className="study-answer">
          <h2>문연 <span>{modes[turn.mode]}</span></h2>
          <p>{turn.reply}</p>
          <button className="study-share" onClick={() => onShare(turn.id)} aria-pressed={selected === turn.id}>
            {selected === turn.id ? '✓ 공유할 답변으로 선택됨' : '이 답변을 제출에 첨부'}
          </button>
        </div>
      </article>)}
      {pending && <article className="study-turn">
        <p className="study-user" aria-label="내 질문">{pending}</p>
        <p className="study-pending" role="status">문연이 답변을 준비하고 있어요…</p>
      </article>}
      <div className="study-latest" ref={latestRef} aria-hidden="true" />
    </div>}

    <div className={'study-dock' + (hasConversation ? ' study-dock-bottom' : ' study-dock-start')}>
      <div className="study-width">
        {!hasConversation && <h1>어떤 부분이 궁금한가요?</h1>}
        <form className="study-composer" ref={formRef} onSubmit={send}>
          <textarea ref={inputRef} aria-label="질문" value={prompt} onChange={event => setPrompt(event.target.value)}
            onKeyDown={handleKey} readOnly={busy} required maxLength={3000} rows={hasConversation ? 2 : 3}
            placeholder={hasConversation ? '이어서 질문해 보세요.' : '과제에서 궁금한 점을 자유롭게 물어보세요.'} />
          <div className="study-composer-bar">
            <div className="study-modes" role="group" aria-label="도움 유형">
              {Object.entries(modes).map(([id, label]) => <button type="button" key={id} disabled={busy}
                aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}
            </div>
            <button className="study-send" type="submit" aria-label="질문 보내기" title="질문 보내기"
              disabled={!model || busy || !prompt.trim()}>{busy ? '…' : '↑'}</button>
          </div>
        </form>
        <Notice message={message} />
        {!model && <p className="study-model-status" role="status">AI 모델이 연결되면 질문을 보낼 수 있어요.</p>}
        {!hasConversation && <div className="study-starters" aria-label="예시 질문">
          {starters.map(starter => <button type="button" key={starter.mode} onClick={() => startWith(starter)}>
            {starter.title} <span aria-hidden="true">↗</span>
          </button>)}
        </div>}
      </div>
    </div>
  </section>;
}

function Submit({ config, turns, selected, onShare, submission, onSubmit, draft, setDraft }) {
  const { busy, run, message } = useAction();
  const selectedTurn = turns.find(turn => turn.id === selected);
  const paragraphs = draft.text.trim().split(/\n\s*\n/).filter(Boolean);
  const hasEvidence = Boolean(selectedTurn || draft.explanation.trim());
  const paragraph = Math.min(draft.paragraph, Math.max(0, paragraphs.length - 1));
  const change = key => event => setDraft(previous => ({
    ...previous, [key]: key === 'paragraph' ? Number(event.target.value) : event.target.value,
  }));
  function submit(event) {
    event.preventDefault();
    run(async () => {
      const result = await api('/submission', 'POST', { ...draft, paragraph, messageId: selectedTurn?.id });
      onSubmit(result.submission);
    });
  }
  return <>
    <Heading title="과제 제출" subtitle={config.title} />
    {submission ? <Panel title="제출 완료"><div className="panel-body">
      <strong>{submission.title}</strong>
      <p className="muted stamp">{new Date(submission.createdAt).toLocaleString('ko-KR')}</p>
    </div></Panel> : <div className="split">
      <Panel title="제출물"><form className="fields panel-body" onSubmit={submit}>
        <label>제목<input value={draft.title} onChange={change('title')} maxLength={160} required /></label>
        <label>본문<textarea value={draft.text} onChange={change('text')} required maxLength={16000} rows={9}
          placeholder="문단 사이에 빈 줄을 넣어 주세요." /></label>
        <label>AI 활용 내용과 이유 <span className="muted">(선택)</span><textarea value={draft.explanation} onChange={change('explanation')} maxLength={1600} rows={3} /></label>
        {hasEvidence && <label>사례와 연결할 문단<select value={paragraph} onChange={change('paragraph')} disabled={!paragraphs.length}>
          {(paragraphs.length ? paragraphs : ['']).map((_, index) => <option key={index} value={index}>본문 {index + 1}문단</option>)}
        </select></label>}
        <Notice message={message} />
        <div className="actions"><button className="primary" disabled={busy}>제출하기</button></div>
      </form></Panel>
      <Panel title="교수자에게 공유되는 내용"><div className="panel-body">
        <dl className="details"><div><dt>제출물</dt><dd>제목과 본문</dd></div>
          <div><dt>이용 요약</dt><dd>{[...new Set(turns.map(turn => modes[turn.mode]))].join(' · ') || '문연 내 이용 기록 없음'}</dd></div>
          {turns.length > 0 && <div><dt>공유 사례</dt><dd>{selectedTurn?.reply || '선택한 학습실 답변 없음'}</dd></div>}
          {draft.explanation.trim() && <div><dt>활용 설명</dt><dd>{draft.explanation}</dd></div>}
        </dl>
        {selectedTurn && <button className="text-button remove" onClick={() => onShare(selected)}>공유 사례 제외</button>}
      </div></Panel>
    </div>}
  </>;
}

function Review({ list, detail, onSelect, onUpdate, onOral, onRefresh, refreshing, model }) {
  const { busy, run, message } = useAction();
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(null);
  const [writing, setWriting] = useState(false);
  const [question, setQuestion] = useState('');
  function focusParagraph(index) {
    setActive(index);
    document.getElementById('paragraph-' + index)?.scrollIntoView({ block: 'nearest' });
  }
  function update(path, method, data, success) {
    run(async notice => {
      await onUpdate(await api('/submissions/' + detail.id + path, method, data));
      setEditing(null);
      setWriting(false);
      notice(success);
    });
  }
  function questionEditor(id) {
    return <form className="fields question-edit" onSubmit={event => {
      event.preventDefault();
      update(id ? '/questions/' + id : '/questions', id ? 'PATCH' : 'POST',
        { text: question, paragraph: active }, id ? '질문을 수정했어요.' : '질문을 추가했어요.');
    }}>
      <label>질문<textarea value={question} onChange={event => setQuestion(event.target.value)} required maxLength={1200} rows={3} /></label>
      <div className="actions"><button className="secondary" type="button" onClick={() => { setEditing(null); setWriting(false); }}>취소</button>
        <button className="primary" disabled={busy}>저장</button></div>
    </form>;
  }
  return <>
    <Heading title="제출물 검토" subtitle="근거 문단을 확인하고 구술평가 질문을 확정하세요."
      action={<button className="secondary" disabled={busy || refreshing} onClick={onRefresh}>목록 새로고침</button>} />
    {!list.length ? <Panel title="제출물 없음"><p className="panel-body muted">학생이 과제를 제출하면 여기에 표시돼요.</p></Panel> :
      <div className="toolbar"><label htmlFor="review-student">제출 학생</label><select id="review-student" value={detail?.id ?? ''} onChange={event => onSelect(Number(event.target.value))}>
        {!detail && <option value="">선택</option>}
        {list.map(item => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}
      </select></div>}
    {detail && <div className="split review">
      <Panel title="과제 본문" aside={<span className="small muted">{detail.name}</span>}>
        <div className="panel-body manuscript">
          <h3>{detail.title}</h3>
          {detail.paragraphs.map((paragraph, index) => <button type="button" key={index} id={'paragraph-' + index}
            aria-pressed={active === index} onClick={() => setActive(index)} className="paragraph">
            <span>문단 {index + 1}</span>{paragraph}
          </button>)}
        </div>
      </Panel>
      <div className="stack">
        <Panel title="AI 이용 요약"><div className="panel-body details">
          <p className="muted">{detail.modes.map(mode => modes[mode]).join(' · ') || '문연 내 이용 기록 없음'}</p>
          {detail.evidence ? <div className="share-box">
            <button className="text-button" onClick={() => focusParagraph(detail.evidence.paragraph)}>{detail.evidence.source} · 문단 {detail.evidence.paragraph + 1} ↗</button>
            {detail.evidence.excerpt && <p>{detail.evidence.excerpt}</p>}
            {detail.evidence.explanation && <p>{detail.evidence.explanation}</p>}
          </div> : <p className="muted small">공유 사례 없음</p>}
        </div></Panel>
        <Panel title="구술 질문" aside={<span className="muted small">{detail.questions.length}개</span>}>
          <div className="panel-body stack">
            <p className="muted small">{detail.config.goal}</p>
            <div className="actions">
              <button className="secondary" disabled={busy || writing || editing !== null}
                onClick={() => { setWriting(true); setQuestion(''); }}>직접 작성</button>
              {model && <button className="primary" disabled={busy} onClick={() => update('/suggest', 'POST', {}, 'AI 질문 후보를 추가했어요.')}>AI 추천</button>}
            </div>
            {writing && <div className="question"><p className="small muted">선택 근거 · 문단 {active + 1}</p>{questionEditor(null)}</div>}
            <Notice message={message} />
            {detail.questions.map(item => {
              const confirmed = detail.evaluation?.questionId === item.id;
              return <article className={'question' + (item.paragraph === active ? ' linked' : '')} key={item.id}>
                <div className="question-meta"><span>{confirmed ? '확정 질문' : item.source}</span>
                  <button className="text-button" onClick={() => focusParagraph(item.paragraph)}>문단 {item.paragraph + 1} ↗</button>
                </div>
                {editing === item.id ? questionEditor(item.id) : <><p>{item.text}</p><div className="actions">
                  <button className="secondary" disabled={busy || writing || editing !== null} onClick={() => {
                    if (confirmed && detail.evaluation.reason !== null && !window.confirm('질문을 수정하면 저장한 평가가 초기화돼요. 수정할까요?')) return;
                    setEditing(item.id); setQuestion(item.text);
                  }}>수정</button>
                  {confirmed ? <button className="primary" onClick={onOral}>구술평가 →</button>
                    : <button className="primary" disabled={busy} onClick={() => {
                      if (detail.evaluation?.reason != null && !window.confirm('질문을 바꾸면 저장한 평가가 초기화돼요. 바꿀까요?')) return;
                      update('/confirm', 'PUT', { questionId: item.id }, '질문을 확정했어요.');
                    }}>질문 확정</button>}
                </div></>}
              </article>;
            })}
          </div>
        </Panel>
      </div>
    </div>}
  </>;
}

function Oral({ detail, onUpdate, onReview }) {
  const { busy, run, message } = useAction();
  const score = detail?.evaluation;
  const question = detail?.questions.find(item => item.id === score?.questionId);
  function save(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    run(async notice => {
      const result = await api('/submissions/' + detail.id + '/evaluation', 'PUT', {
        questionId: question.id, questionText: question.text, reason: Number(fields.get('reason')),
        transfer: Number(fields.get('transfer')), memo: fields.get('memo'),
      });
      await onUpdate(result);
      notice('구술평가를 저장했어요.');
    });
  }
  return <>
    <Heading title="구술평가" subtitle={detail?.name} action={<button className="secondary" onClick={onReview}>← 제출물 검토</button>} />
    {!question ? <Panel title="확정 질문 없음"><p className="panel-body muted">검토 화면에서 질문을 먼저 확정해 주세요.</p></Panel> :
      <div className="split">
        <Panel title="확정 질문"><div className="panel-body stack"><p className="oral-question">{question.text}</p>
          <div className="share-box"><b className="small">근거 · 문단 {question.paragraph + 1}</b><p>{detail.paragraphs[question.paragraph]}</p></div>
        </div></Panel>
        <Panel title="채점" aside={<span className="small muted">{score.reason == null ? '4점 만점' : (score.reason + score.transfer) + ' / 4점'}</span>}>
          <form className="fields panel-body" onSubmit={save}>
            <p className="muted small">{detail.config.rubric}</p>
            {[['reason', '선택의 근거'], ['transfer', '조건 변화의 영향']].map(([key, label]) =>
              <fieldset key={key}><legend>{label}</legend><div className="score-options">{[0, 1, 2].map(value =>
                <label key={value}><input type="radio" name={key} value={value} defaultChecked={score[key] === value} required />{value}점</label>)}</div></fieldset>)}
            <label>평가 메모<textarea name="memo" defaultValue={score.memo} maxLength={3000} rows={3} /></label>
            <Notice message={message} />
            <div className="actions"><button className="primary" disabled={busy}>평가 저장</button></div>
          </form>
        </Panel>
      </div>}
  </>;
}

function Workspace({ session, onLogout }) {
  const teacher = session.user.role === 'teacher';
  const [page, setPage] = useState(teacher ? 'review' : session.model ? 'learn' : 'guidance');
  const [config, setConfig] = useState(null);
  const [list, setList] = useState([]);
  const [detail, setDetail] = useState(null);
  const [turns, setTurns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [draft, setDraft] = useState({ title: '', text: '', explanation: '', paragraph: 0 });
  const [loading, setLoading] = useState(true);
  const { run, busy, message } = useAction();

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const assignment = await api('/assignment');
        if (teacher) {
          const entries = await api('/submissions');
          const initial = entries.length ? await api('/submissions/' + entries[0].id) : null;
          if (!current) return;
          setList(entries); setDetail(initial);
        } else {
          const [messages, result] = await Promise.all([api('/learning'), api('/submission')]);
          if (!current) return;
          setTurns(messages); setSubmission(result.submission);
        }
        setConfig(assignment);
      } catch (error) {
        if (current) run(() => { throw error; });
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [teacher]);

  const menu = teacher
    ? [['review', '제출물 검토'], ['setup', '과제 설정'], ['oral', '구술평가']]
    : [[session.model ? 'learn' : 'guidance', session.model ? 'AI 학습실' : '과제 안내'], ['submit', '과제 제출']];
  const share = id => setSelected(current => current === id ? null : id);
  const select = id => run(async () => setDetail(await api('/submissions/' + id)));
  const refresh = () => run(async () => {
    const entries = await api('/submissions');
    const id = entries.find(entry => entry.id === detail?.id)?.id ?? entries[0]?.id;
    const next = id ? await api('/submissions/' + id) : null;
    setList(entries);
    setDetail(next);
  });
  function update(result) {
    setDetail(current => current?.id === result.id ? result : current);
    const status = result.evaluation?.reason != null ? '평가 완료' : result.evaluation ? '질문 확정' : '검토 대기';
    setList(current => current.map(item => item.id === result.id ? { ...item, status } : item));
  }

  return <div className="app">
    <header className="topbar"><div className="wordmark">문연<span className="wordmark-dot">.</span></div>
      <div className="account"><span>{session.user.name} · {teacher ? '교수자' : '학생'}</span>
        <button className="text-button" disabled={busy} onClick={() => run(async () => { await api('/logout', 'POST'); onLogout(); })}>로그아웃</button>
      </div>
    </header>
    <div className="layout">
      <aside className="sidebar"><div className="course"><span>과목</span><strong>{config?.course || '문연'}</strong></div>
        <nav aria-label="작업 공간">{menu.map(([id, label]) => <button key={id} onClick={() => setPage(id)} aria-current={page === id ? 'page' : undefined}>{label}</button>)}</nav>
      </aside>
      <main className={'workspace' + (page === 'learn' ? ' study-workspace' : '')}>
        <Notice message={message} />
        {loading && <p role="status" className="muted">과제를 불러오는 중…</p>}
        {config && page === 'setup' && <Setup config={config} onSave={setConfig} />}
        {config && page === 'guidance' && <>
          <Heading title="과제 안내" subtitle={config.title} action={<button className="primary" onClick={() => setPage('submit')}>과제 작성하기 →</button>} />
          <Panel title="과제 지침"><div className="panel-body"><Guidance config={config} /></div></Panel>
        </>}
        {config && !teacher && session.model && <Learn config={config} model={session.model} turns={turns} setTurns={setTurns}
          selected={selected} onShare={share} onSubmitPage={() => setPage('submit')} active={page === 'learn'} />}
        {config && page === 'submit' && <Submit config={config} turns={turns} selected={selected} onShare={share}
          submission={submission} onSubmit={setSubmission} draft={draft} setDraft={setDraft} />}
        {config && page === 'review' && <Review key={detail?.id ?? 0} detail={detail} list={list} onSelect={select}
          onUpdate={update} model={session.model} onOral={() => setPage('oral')} onRefresh={refresh} refreshing={busy} />}
        {config && page === 'oral' && <Oral detail={detail} onUpdate={update} onReview={() => setPage('review')} />}
      </main>
    </div>
  </div>;
}

function App() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api('/session').then(setSession).catch(error => setError(error.message)); }, []);
  if (error) return <main className="login-page"><p role="alert">{error}</p></main>;
  if (!session) return <main className="login-page"><p role="status">문연을 여는 중…</p></main>;
  if (!session.user) return <Login onLogin={setSession} demo={session.demo} />;
  return <Workspace key={session.user.id} session={session} onLogout={() => setSession({ ...session, user: null })} />;
}

createRoot(document.getElementById('root')).render(<App />);
