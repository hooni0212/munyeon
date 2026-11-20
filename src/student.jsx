import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { clock, go, href, paragraphs, replace, useRoute, useScreenFocus, when } from './lib.js';
import {
  Details, Icon, Intro, LinkButton, Notice, Pane, PaneTabs, Pill, ReportSummary, Rules, Steps, Trail, WorkbenchTop,
} from './ui.jsx';
import { Shell } from './shell.jsx';

const chatModes = { concept: '개념 설명', hint: '힌트', feedback: '초안 피드백' };
const starters = [
  { mode: 'concept', label: '개념 설명', prompt: '이 과제에 필요한 개념을 예시와 함께 설명해 줘.' },
  { mode: 'hint', label: '근거 찾기', prompt: '이 과제에서 근거는 어떻게 수집하면 좋을까?' },
  { mode: 'feedback', label: '초안 점검', prompt: '내 초안의 근거와 논리 흐름을 점검해 줘.' },
];
const editSteps = new Set(['report', 'evidence', 'confirm']);
const views = new Set(['home', 'assignment', 'write', ...editSteps, 'receipt']);

function reportValid(report, draft, turns) {
  if (report.mode === 'none') return true;
  if (report.mode === 'manual') return Boolean(report.manualExplanation.trim());
  if (report.mode === 'shared') {
    return turns.some(turn => turn.id === report.messageId) && report.paragraph < paragraphs(draft.body).length &&
      Boolean(report.explanation.trim());
  }
  return false;
}

function reportPreview(report, turns) {
  if (report.mode !== 'shared') return { mode: report.mode, explanation: report.manualExplanation };
  const turn = turns.find(item => item.id === report.messageId);
  return { mode: 'shared', paragraph: report.paragraph, explanation: report.explanation, question: turn?.prompt, excerpt: turn?.reply };
}

function useAutosize(value, visible) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field || !field.offsetWidth) return;
    field.style.height = 'auto';
    field.style.height = field.scrollHeight + 1 + 'px';
  }, [value, visible]);
  return ref;
}

export function StudentApp({ session, onLogout }) {
  const route = useRoute();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState({ state: 'idle', at: null });
  const [failure, setFailure] = useState(null);
  const [pane, setPane] = useState('editor');
  const dirty = useRef(false);
  const timer = useRef(null);
  const model = Boolean(session.model);

  useEffect(() => {
    Promise.all([api('/assignment'), api('/draft'), api('/learning'), api('/submission')])
      .then(([assignment, stored, turns, { submission }]) => {
        setData({ assignment, turns, submission });
        setDraft({ title: stored.title, body: stored.body, report: stored.report });
        setSaved({ state: 'idle', at: stored.updatedAt });
      })
      .catch(error => setFailure(error.message));
  }, []);

  // 입력을 멈추고 0.7초가 지나면 서버에 초안을 저장한다.
  useEffect(() => {
    if (!draft || !dirty.current || data?.submission) return;
    setSaved(current => ({ ...current, state: 'pending' }));
    timer.current = setTimeout(async () => {
      dirty.current = false;
      setSaved(current => ({ ...current, state: 'saving' }));
      try {
        const result = await api('/draft', 'PUT', draft);
        setSaved({ state: 'saved', at: result.updatedAt });
      } catch (error) {
        dirty.current = true;
        setSaved(current => ({ ...current, state: 'error', message: error.message }));
      }
    }, 700);
    return () => clearTimeout(timer.current);
  }, [draft]);

  useEffect(() => {
    const warn = event => { if (dirty.current) event.preventDefault(); };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, []);

  let key = views.has(route.key) ? route.key : 'home';
  if (data && draft) {
    const draftReady = Boolean(draft.title.trim() && draft.body.trim());
    if (data.submission && editSteps.has(key)) key = 'receipt';
    if (!data.submission && key === 'receipt') key = 'home';
    if (editSteps.has(key) && !draftReady) key = 'write';
    if (key === 'evidence' && (!data.turns.length || draft.report.mode !== 'shared')) key = 'report';
    if (key === 'confirm' && !reportValid(draft.report, draft, data.turns)) key = 'report';
  }
  useEffect(() => { if (data && route.key !== key) replace(key); }, [data, route.key, key]);
  useScreenFocus({ key });

  const change = values => {
    dirty.current = true;
    setDraft(current => ({ ...current, ...values }));
  };
  const changeReport = values => change({ report: { ...draft.report, ...values } });
  const workbench = key === 'write';

  let content;
  if (failure) content = <Notice message={{ text: failure, error: true }} />;
  else if (!data || !draft) content = <p className="muted" role="status">과제를 불러오는 중…</p>;
  else {
    const props = { ...data, draft, model, change, changeReport };
    content = {
      home: () => <Home {...props} />,
      assignment: () => <Assignment {...props} openChat={() => { setPane('chat'); go('write'); }} />,
      write: () => <Write {...props} saved={saved} pane={pane} setPane={setPane}
        setTurns={turns => setData(current => ({ ...current, turns: turns(current.turns) }))} />,
      report: () => <Report {...props} />,
      evidence: () => <Evidence {...props} />,
      confirm: () => <Confirm {...props} onSubmitted={submission => {
        clearTimeout(timer.current);
        dirty.current = false;
        setData(current => ({ ...current, submission }));
        go('receipt');
      }} />,
      receipt: () => <Receipt {...props} />,
    }[key]();
  }

  return <Shell user={session.user} home={href('home')} onLogout={onLogout} workbench={workbench}
    nav={[[href('home'), '내 과제', true]]}>{content}</Shell>;
}

function Home({ assignment, submission }) {
  return <>
    <Intro title="내 과제" context={assignment.course} />
    <ul className="assignment-list"><li className="card row adapt">
      <div className="stack tight">
        <div className="tags"><Pill tone={submission ? '' : 'neutral'}>{submission ? '제출 완료' : '작성 중'}</Pill></div>
        <h2>{assignment.title}</h2>
        <p className="muted small">마감 {when(assignment.due)}</p>
      </div>
      <div className="tags">
        <LinkButton to="assignment" secondary>과제 안내</LinkButton>
        <LinkButton to={submission ? 'receipt' : 'write'}>{submission ? '제출 내역 보기' : '작업실 열기'}</LinkButton>
      </div>
    </li></ul>
  </>;
}

function Assignment({ assignment, submission, model, openChat }) {
  return <>
    <Trail to={href('home')}>내 과제</Trail>
    <Intro title={assignment.title} context={[assignment.course, assignment.section].filter(Boolean).join(' · ')} />
    <div className="assignment-meta"><span>마감 {when(assignment.due)}</span>
      <Pill tone={submission ? '' : 'neutral'}>{submission ? '제출 완료' : '작성 중'}</Pill></div>
    <div className="stack">
      <section className="card"><h2>과제 안내</h2><p className="plain-text">{assignment.prompt}</p></section>
      <section className="card tint"><h2>이 과제의 AI 활용 기준</h2><Rules assignment={assignment} />
        {model && !submission && <div className="material"><button type="button" className="text-link" onClick={openChat}>과제 AI 대화 열기</button></div>}
      </section>
    </div>
    <div className="actions end">
      <LinkButton to={submission ? 'receipt' : 'write'}>{submission ? '제출 내역 보기' : '과제 이어서 작성'}</LinkButton>
    </div>
  </>;
}

function saveLabel(saved) {
  if (saved.state === 'pending' || saved.state === 'saving') return '저장 중…';
  if (saved.state === 'error') return '저장하지 못했어요 · ' + saved.message;
  return saved.at ? '초안 저장됨 · ' + clock(saved.at) : '편집하면 자동 저장';
}

function Write({ assignment, draft, submission, turns, model, change, changeReport, saved, pane, setPane, setTurns }) {
  const [context, setContext] = useState('');
  const [status, setStatus] = useState('');
  const chatInput = useRef(null);
  const form = useRef(null);
  const doc = submission ? { title: submission.title, body: submission.paragraphs.join('\n\n') } : draft;
  const titleRef = useAutosize(doc.title, pane);
  const bodyRef = useAutosize(doc.body, pane);
  const count = paragraphs(doc.body).length;

  function prepare(event) {
    event.preventDefault();
    setPane('editor');
    if (form.current.reportValidity()) go('report');
  }
  function askSelection() {
    const field = bodyRef.current;
    const selection = field.value.slice(field.selectionStart, field.selectionEnd).trim();
    if (!selection) {
      setStatus('본문에서 질문할 문장을 먼저 선택하세요.');
      field.focus();
      return;
    }
    setContext(selection.slice(0, 400));
    setStatus('선택한 문장을 질문에 붙였어요.');
    setPane('chat');
    requestAnimationFrame(() => chatInput.current?.focus());
  }
  async function importText(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.txt') || file.size > 64 * 1024) {
      setStatus('64 KiB 이하의 .txt 파일을 선택해 주세요.');
      return;
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).replace(/\r\n?/g, '\n');
      if (!text.trim() || text.length > 16000) {
        setStatus('본문이 비어 있거나 16,000자를 넘어요.');
        return;
      }
      if (draft.body.trim() && !confirm('지금 본문을 파일 내용으로 바꿀까요?')) return;
      change({ body: text });
      setStatus(file.name + ' · 본문에 반영했어요.');
    } catch {
      setStatus('파일을 읽을 수 없어요. UTF-8로 저장한 .txt 파일을 선택해 주세요.');
    }
  }

  const actions = submission
    ? <LinkButton to="receipt" compact>제출 내역</LinkButton>
    : <>
      <span className={'save-indicator' + (saved.state === 'error' ? ' failed' : '')}>
        <Icon name={saved.state === 'error' ? 'alert' : 'check'} small /><span role="status">{saveLabel(saved)}</span>
      </span>
      <button className="button compact" type="button" onClick={prepare}>제출 준비</button>
    </>;

  return <div className="workbench-shell">
    <WorkbenchTop title={assignment.title} context={[assignment.course, assignment.section].filter(Boolean).join(' · ')}
      back={href('home')} backLabel="내 과제로">{actions}</WorkbenchTop>
    <PaneTabs items={[['assignments', '과제'], ['chat', model ? 'AI 대화' : 'AI 기준'], ['editor', '편집기']]} active={pane} onChange={setPane} />
    <div className="workbench-grid student-grid">
      <Pane id="assignments" active={pane} className="rail" title="내 과제" icon="list">
        <div className="pane-scroll rail-content">
          <div className="stack tight">
            <p className="course-name">{assignment.course}</p>
            <button className="rail-link" type="button" aria-current="page" onClick={() => { setPane('editor'); bodyRef.current?.focus(); }}>
              <Icon name="file" small /><span><strong>{assignment.title}</strong>
                <small>{submission ? '제출 완료' : '마감 ' + when(assignment.due)}</small></span>
            </button>
          </div>
          <a className="icon-button bordered" href={href('assignment')}><Icon name="list" small />과제 안내</a>
        </div>
      </Pane>
      <Chat assignment={assignment} turns={turns} model={model} report={draft.report} submitted={Boolean(submission)}
        changeReport={changeReport} setTurns={setTurns} pane={pane} context={context} setContext={setContext} inputRef={chatInput} />
      <Pane id="editor" active={pane} className="editor-pane" title="문서 편집기" icon="file">
        <form ref={form} className="editor-form" onSubmit={prepare}>
          {!submission && <div className="editor-tools">
            {model && <button className="icon-button" type="button" onClick={askSelection}><Icon name="chat" small />선택한 문장 질문</button>}
            <label className="icon-button file-button"><Icon name="attach" small />.txt 불러오기
              <input type="file" accept=".txt,text/plain" onChange={importText} /></label>
          </div>}
          <div className="pane-scroll paper-scroll">
            <article className="paper-sheet">
              <label className="doc-label" htmlFor="doc-title">제출물 제목</label>
              <textarea ref={titleRef} className="doc-title" id="doc-title" rows={1} maxLength={160} required readOnly={Boolean(submission)}
                placeholder="제출물 제목을 입력하세요" value={doc.title} onChange={event => change({ title: event.target.value.replace(/\n/g, ' ') })} />
              <hr className="doc-rule" />
              <label className="doc-label" htmlFor="doc-body">본문</label>
              <textarea ref={bodyRef} className="doc-body" id="doc-body" rows={7} maxLength={16000} required readOnly={Boolean(submission)}
                placeholder="본문을 입력하세요. 한 줄을 비우면 새 문단이 돼요." value={doc.body}
                onChange={event => change({ body: event.target.value })} />
            </article>
          </div>
          <div className="doc-status"><span role="status">{status}</span>
            <span>문단 {count} · {doc.body.length.toLocaleString('ko-KR')}자</span></div>
        </form>
      </Pane>
    </div>
  </div>;
}

function Chat({ assignment, turns, model, report, submitted, changeReport, setTurns, pane, context, setContext, inputRef }) {
  const [mode, setMode] = useState('concept');
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(null);
  const [status, setStatus] = useState('');
  const scroll = useRef(null);

  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [turns.length, pending, pane]);

  async function send(event) {
    event.preventDefault();
    const text = question.trim();
    if (!text || pending) return;
    const prompt = context ? '선택한 문장: "' + context + '"\n\n' + text : text;
    setPending(prompt);
    setStatus('');
    try {
      const turn = await api('/learning', 'POST', { mode, prompt });
      setTurns(current => [...current, turn]);
      setQuestion('');
      setContext('');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setPending(null);
    }
  }
  function mark(id) {
    const remove = report.mode === 'shared' && report.messageId === id;
    changeReport(remove ? { mode: '', messageId: null } : { mode: 'shared', messageId: id });
    setStatus(remove ? '활용 사례 표시를 해제했어요.' : '활용 사례로 표시했어요. 제출 준비에서 문단에 연결해요.');
  }

  let composer;
  if (submitted) composer = <p className="chat-compose hint">제출한 과제의 대화는 열람만 할 수 있어요.</p>;
  else if (!model) composer = null;
  else composer = <div className="chat-compose">
    <div className="prompt-list" role="group" aria-label="도움 유형">
      {starters.map(starter => <button key={starter.mode} type="button" aria-pressed={mode === starter.mode}
        onClick={() => { setMode(starter.mode); if (!question.trim()) setQuestion(starter.prompt); inputRef.current?.focus(); }}>{starter.label}</button>)}
    </div>
    {context && <div className="context-chip"><span>선택 문장 · {context}</span>
      <button type="button" aria-label="선택 문장 첨부 제거" onClick={() => setContext('')}>×</button></div>}
    <form className="composer" onSubmit={send}>
      <input ref={inputRef} aria-label="AI에게 질문" placeholder="과제에 대해 질문하기" maxLength={2400} required
        value={question} onChange={event => setQuestion(event.target.value)} readOnly={Boolean(pending)} />
      <button type="submit" className="button" aria-label="질문 보내기" title="질문 보내기" disabled={Boolean(pending) || !question.trim()}>
        <Icon name="send" /></button>
    </form>
    <p className="hint" role="status">{status || '교수자에게는 사용한 도움 유형과, 활용 사례로 표시한 대화만 전달돼요.'}</p>
  </div>;

  return <Pane id="chat" active={pane} className="chat-pane" title={model ? '과제 AI' : 'AI 활용 기준'} icon="chat"
    aside={<span className="meta">{model ? chatModes[mode] : 'AI 대화 꺼짐'}</span>}>
    <div className="pane-scroll chat-body" ref={scroll}>
      <details className="chat-rules disclosure" open><summary>이 과제의 AI 활용 기준</summary><Rules assignment={assignment} /></details>
      {turns.length || pending ? <ol className="chat-stream" aria-label="AI 대화">
        {turns.map(turn => {
          const tagged = report.mode === 'shared' && report.messageId === turn.id;
          return <li className="chat-turn" key={turn.id}>
            <div className="chat-message mine"><strong>나 · {chatModes[turn.mode]}</strong>{turn.prompt}</div>
            <div className="chat-message ai"><strong><Icon name="star" small />과제 AI</strong>{turn.reply}</div>
            {!submitted && <div className="chat-select"><button type="button" className="icon-button" aria-pressed={tagged} onClick={() => mark(turn.id)}>
              <Icon name={tagged ? 'check' : 'link'} small />{tagged ? '활용 사례로 표시됨' : '활용 사례로 표시'}</button></div>}
          </li>;
        })}
        {pending && <li className="chat-turn"><div className="chat-message mine"><strong>나</strong>{pending}</div>
          <p className="chat-pending" role="status">답변을 준비하고 있어요…</p></li>}
      </ol> : <p className="chat-empty">{model
        ? '과제에 대해 궁금한 점을 물어보세요. 대화는 저장되고, 활용 사례로 표시한 대화만 제출할 때 교수자에게 전달돼요.'
        : '이 과제에서는 문연 AI 대화를 사용하지 않아요. 다른 AI 도구를 활용했다면 제출 준비 단계에서 활용 내용을 직접 적어 주세요.'}</p>}
    </div>
    {composer}
  </Pane>;
}

function Report({ assignment, draft, turns, changeReport }) {
  const { report } = draft;
  const selected = turns.find(turn => turn.id === report.messageId);
  function choose(mode) {
    changeReport(mode === 'shared' && !selected ? { mode, messageId: turns.at(-1)?.id ?? null } : { mode });
  }
  function next(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    go(report.mode === 'shared' ? 'evidence' : 'confirm');
  }
  return <>
    <Trail to={href('write')}>과제 작성</Trail>
    <Steps current={2} />
    <Intro title="AI 활용 확인" subtitle="이 과제에서 AI 도움을 어떻게 활용했는지 선택하세요." context={assignment.course + ' · ' + assignment.title} />
    <form onSubmit={next}>
      <section className="card stack">
        <fieldset><legend>활용 방식</legend>
          <label className="choice"><input type="radio" name="mode" required checked={report.mode === 'shared'}
            disabled={!turns.length} onChange={() => choose('shared')} />
            <span>문연 대화 사례 연결{!turns.length && <span className="hint"> · 문연에서 나눈 대화가 없어요</span>}</span></label>
          <label className="choice"><input type="radio" name="mode" checked={report.mode === 'manual'} onChange={() => choose('manual')} />
            <span>활용 내용 직접 입력 <span className="hint">· 다른 AI 도구를 썼을 때</span></span></label>
          <label className="choice"><input type="radio" name="mode" checked={report.mode === 'none'} onChange={() => choose('none')} />
            <span>AI를 사용하지 않음</span></label>
        </fieldset>
        {report.mode === 'shared' && <div className="material"><h3>선택한 대화</h3>
          <p className="muted">{selected?.prompt || '연결할 대화를 다음 단계에서 고를 수 있어요.'}</p></div>}
        {report.mode === 'manual' && <div className="fields"><label>내가 받은 도움과 직접 한 판단
          <textarea rows={4} maxLength={1600} required value={report.manualExplanation}
            placeholder="예: 아이디어를 정리할 때 사용했고, 최종 기준은 직접 선택했습니다."
            onChange={event => changeReport({ manualExplanation: event.target.value })} /></label></div>}
      </section>
      <div className="actions end"><button className="button">{report.mode === 'shared' ? '활용 사례 연결로' : '제출 확인으로'}</button></div>
    </form>
  </>;
}

function Evidence({ assignment, draft, turns, changeReport }) {
  const { report } = draft;
  const parts = paragraphs(draft.body);
  const selected = turns.find(turn => turn.id === report.messageId) ?? turns.at(-1);
  function next(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    changeReport({ messageId: selected.id, paragraph: Math.min(report.paragraph, parts.length - 1) });
    go('confirm');
  }
  return <>
    <Trail to={href('report')}>AI 활용 확인</Trail>
    <Steps current={2} />
    <Intro title="활용 사례 연결" subtitle="대화 한 건을 과제의 관련 문단에 연결하세요." context={assignment.course + ' · ' + assignment.title} />
    <form onSubmit={next}>
      <section className="card fields">
        <label>공유할 대화<select value={selected.id} onChange={event => changeReport({ messageId: Number(event.target.value) })}>
          {turns.map(turn => <option key={turn.id} value={turn.id}>{turn.prompt.slice(0, 60)}</option>)}</select></label>
        <div className="notice plain-text">{selected.reply}</div>
        <label>연결할 문단<select value={Math.min(report.paragraph, parts.length - 1)} onChange={event => changeReport({ paragraph: Number(event.target.value) })}>
          {parts.map((part, index) => <option key={index} value={index}>문단 {index + 1} · {part.slice(0, 38)}</option>)}</select></label>
        <label>나의 활용 설명<textarea rows={3} maxLength={1600} required value={report.explanation}
          placeholder="예: 단계 구분은 참고했고, 각 단계의 기준은 직접 작성했습니다."
          onChange={event => changeReport({ explanation: event.target.value })} /></label>
      </section>
      <div className="actions end"><button className="button">제출 확인으로</button></div>
    </form>
  </>;
}

function Confirm({ assignment, draft, turns, onSubmitted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { submission } = await api('/submission', 'POST', { title: draft.title, text: draft.body, report: draft.report });
      onSubmitted(submission);
    } catch (failure) {
      setError({ text: failure.message, error: true });
      setBusy(false);
    }
  }
  return <>
    <Trail to={href('report')}>AI 활용 확인</Trail>
    <Steps current={3} />
    <Intro title="제출 내용 확인" subtitle="아래 과제와 AI 활용 내용이 교수자에게 전달돼요." context={assignment.course + ' · ' + assignment.title} />
    <form onSubmit={submit}>
      <div className="stack">
        <section className="card"><div className="row adapt"><h2>과제 본문</h2><a className="text-link" href={href('write')}>과제 수정</a></div>
          <p className="doc-preview-title">{draft.title}</p>
          <p className="muted small">문단 {paragraphs(draft.body).length} · {draft.body.trim().length.toLocaleString('ko-KR')}자</p>
          <details className="disclosure material"><summary>본문 미리 보기</summary><p className="plain-text">{draft.body.trim()}</p></details>
        </section>
        <section className="card"><div className="row adapt"><h2>교수자에게 전달되는 AI 활용 내용</h2>
          <a className="text-link" href={href('report')}>활용 내용 수정</a></div>
          <ReportSummary report={reportPreview(draft.report, turns)} />
          {turns.length > 0 && <p className="muted small material">문연에서 사용한 도움 유형({[...new Set(turns.map(turn => chatModes[turn.mode]))].join(' · ')})도 함께 전달돼요. 표시하지 않은 대화 내용은 전달되지 않아요.</p>}
        </section>
        <p className="notice warn">제출 후에는 내용을 수정할 수 없어요.</p>
        <Notice message={error} />
      </div>
      <div className="actions end"><button className="button" disabled={busy}>{busy ? '제출하는 중…' : '과제 최종 제출'}</button></div>
    </form>
  </>;
}

function Receipt({ assignment, submission }) {
  return <>
    <Trail to={href('home')}>내 과제</Trail>
    <Intro title="제출 완료" context={assignment.course + ' · ' + assignment.title} />
    <section className="card receipt">
      <div className="check" aria-hidden="true">✓</div>
      <h2>{submission.title}</h2>
      <Details entries={[['제출 시각', when(submission.createdAt)], ['제출 상태', '제출 완료 · 수정 불가'], ['다음 단계', '교수자가 제출물을 바탕으로 구술 질문을 준비해요.']]} />
      <details className="disclosure material"><summary>제출한 본문과 AI 활용 내용 보기</summary>
        <p className="plain-text">{submission.paragraphs.join('\n\n')}</p>
        <section className="material"><h3>AI 활용 내용</h3><ReportSummary report={submission.evidence} /></section>
      </details>
    </section>
    <div className="actions end"><LinkButton to="home" secondary>내 과제로 돌아가기</LinkButton></div>
  </>;
}
