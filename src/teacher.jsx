import { useEffect, useState } from 'react';
import { api } from './api.js';
import { clock, go, href, replace, statusTone, useRoute, useScreenFocus, when } from './lib.js';
import {
  Icon, Intro, LinkButton, Notice, Pane, PaneTabs, Pill, ReportSummary, Rules, Trail, WorkbenchTop,
} from './ui.jsx';
import { Shell } from './shell.jsx';

const chatModes = { concept: '개념 설명', hint: '힌트', feedback: '초안 피드백' };
const reviewViews = new Set(['review', 'question', 'score']);
const views = new Set(['roster', ...reviewViews, 'setup', 'policy']);
const statuses = ['전체', '검토 대기', '질문 준비 완료', '평가 완료', '미제출'];
const criteria = [['reason', '선택의 근거'], ['transfer', '조건이 달라질 때의 판단']];

const statusOf = detail => detail.evaluation?.reason != null ? '평가 완료' : detail.evaluation ? '질문 준비 완료' : '검토 대기';
const confirmedQuestion = detail => detail.questions.find(item => item.id === detail.evaluation?.questionId) ?? null;
const contextOf = assignment => [assignment.course, assignment.section, assignment.title].filter(Boolean).join(' · ');

export function TeacherApp({ session, onLogout }) {
  const route = useRoute();
  const [assignment, setAssignment] = useState(null);
  const [roster, setRoster] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const [detail, setDetail] = useState(null);
  const [failure, setFailure] = useState(null);
  const [filter, setFilter] = useState({ query: '', status: '전체' });
  const [pane, setPane] = useState('document');
  const [positions, setPositions] = useState({});
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [policyDraft, setPolicyDraft] = useState(null);
  const [notice, setNotice] = useState('');

  async function loadRoster() {
    const rows = await api('/roster');
    setRoster(rows);
    setCheckedAt(new Date().toISOString());
  }
  useEffect(() => {
    Promise.all([api('/assignment'), loadRoster()]).then(([config]) => setAssignment(config))
      .catch(error => setFailure(error.message));
  }, []);

  let key = views.has(route.key) ? route.key : 'roster';
  const id = reviewViews.has(key) ? route.id : null;
  if (roster && reviewViews.has(key) && !roster.some(row => row.id === id)) key = 'roster';
  useEffect(() => {
    if (roster && (route.key !== key || (reviewViews.has(key) ? route.id !== id : route.id != null))) replace(key, reviewViews.has(key) ? id : null);
  }, [roster, route.key, route.id, key, id]);
  useEffect(() => {
    if (key !== 'setup') setNotice('');
    if (key !== 'question') setPendingQuestion(null);
  }, [key]);

  useEffect(() => {
    if (!reviewViews.has(key) || id == null) return;
    let current = true;
    api('/submissions/' + id).then(result => { if (current) setDetail(result); }).catch(error => setFailure(error.message));
    return () => { current = false; };
  }, [key, id]);
  useScreenFocus({ key, id });

  function updateDetail(result) {
    setDetail(result);
    setRoster(rows => rows.map(row => row.id === result.id ? { ...row, status: statusOf(result) } : row));
  }

  const workbench = key === 'review';
  const nav = [[href('roster'), '제출물 검토', !['setup', 'policy'].includes(key)], [href('setup'), '과제 설정', ['setup', 'policy'].includes(key)]];
  let content;
  if (failure) content = <Notice message={{ text: failure, error: true }} />;
  else if (!assignment || !roster) content = <p className="muted" role="status">제출 현황을 불러오는 중…</p>;
  else if (reviewViews.has(key) && detail?.id !== id) content = <p className="muted" role="status">제출물을 불러오는 중…</p>;
  else {
    const visible = roster.filter(row => row.name.includes(filter.query.trim()) && (filter.status === '전체' || row.status === filter.status));
    const shared = { assignment, roster, visible, filter, setFilter, detail, model: Boolean(session.model), updateDetail };
    content = {
      roster: () => <Roster {...shared} checkedAt={checkedAt} refresh={() => loadRoster().catch(error => setFailure(error.message))} />,
      review: () => <Review {...shared} pane={pane} setPane={setPane}
        paragraph={positions[id] ?? (detail.evidence.mode === 'shared' ? detail.evidence.paragraph : 0)}
        setParagraph={index => setPositions(current => ({ ...current, [id]: index }))}
        startQuestion={(paragraph, text) => { setPendingQuestion({ id, paragraph, text }); go('question', id); }} />,
      question: () => <Question key={id} {...shared} pending={pendingQuestion?.id === id ? pendingQuestion : null} />,
      score: () => <Score key={id} {...shared} />,
      setup: () => <Setup assignment={policyDraft ?? assignment} submitted={roster.filter(row => row.id).length} notice={notice}
        onNext={values => { setPolicyDraft({ ...(policyDraft ?? assignment), ...values }); go('policy'); }} />,
      policy: () => <Policy assignment={policyDraft ?? assignment} onSaved={config => {
        setAssignment(config);
        setPolicyDraft(null);
        setNotice('과제 설정을 저장했어요. 학생 화면에 바로 반영돼요.');
        go('setup');
      }} />,
    }[key]();
  }

  return <Shell user={session.user} home={href('roster')} onLogout={onLogout} nav={nav} workbench={workbench} wide={key === 'roster'}>
    {content}
  </Shell>;
}

function Filters({ filter, setFilter, compact }) {
  return <div className={compact ? 'rail-tools' : 'filters'}>
    <label className="field">학생 검색<input type="search" value={filter.query} placeholder="이름으로 검색"
      onChange={event => setFilter({ ...filter, query: event.target.value })} /></label>
    <label className="field">검토 상태<select value={filter.status} onChange={event => setFilter({ ...filter, status: event.target.value })}>
      {statuses.map(status => <option key={status}>{status}</option>)}</select></label>
  </div>;
}

function Roster({ assignment, roster, visible, filter, setFilter, checkedAt, refresh }) {
  const ready = roster.filter(row => row.id).length;
  const counts = Object.fromEntries(statuses.slice(1).map(status => [status, roster.filter(row => row.status === status).length]));
  return <>
    <Intro title="학생 제출 현황" subtitle={`제출 ${ready}명 · 미제출 ${roster.length - ready}명`} context={contextOf(assignment)} />
    <ul className="summary-strip" aria-label="검토 진행 상황">
      {statuses.slice(1).map(status => <li key={status}>
        <button type="button" aria-pressed={filter.status === status}
          onClick={() => setFilter({ ...filter, status: filter.status === status ? '전체' : status })}>
          <strong>{counts[status]}</strong><span>{status}</span></button></li>)}
    </ul>
    <section className="card">
      <div className="row roster-head"><Filters filter={filter} setFilter={setFilter} />
        <button type="button" className="icon-button bordered" onClick={refresh}>새로고침 {checkedAt && <span className="muted">· {clock(checkedAt)}</span>}</button>
      </div>
      <div aria-live="polite">{visible.length ? <ul className="roster">{visible.map(row => <li key={row.studentId}>
        <div><strong>{row.name}</strong>{row.id && <p className="small muted">{when(row.createdAt)} 제출 · {row.title}</p>}</div>
        <Pill tone={statusTone(row.status)}>{row.status}</Pill>
        <div>{row.id ? <LinkButton to="review" id={row.id} secondary compact>검토하기</LinkButton> : <span className="small muted">제출물 없음</span>}</div>
      </li>)}</ul> : <p className="muted material">조건에 맞는 학생이 없어요.</p>}</div>
    </section>
  </>;
}

function WorkTabs({ active, id }) {
  return <nav className="work-tabs" aria-label="학생 검토 메뉴">
    {[['review', '제출물 검토'], ['question', '구술 질문'], ['score', '구술평가']].map(([key, label]) =>
      <a key={key} href={href(key, id)} aria-current={key === active ? 'page' : undefined}>{label}</a>)}
  </nav>;
}

function Neighbors({ roster, id, to = 'review' }) {
  const ids = roster.filter(row => row.id).map(row => row.id);
  const index = ids.indexOf(id);
  return <nav className="student-pagination" aria-label="제출 학생 이동">
    {[[ids[index - 1], '이전 학생', 'arrow'], [ids[index + 1], '다음 학생', 'right']].map(([target, label, icon]) => target
      ? <a key={label} className="icon-button" href={href(to, target)}><Icon name={icon} small />{label}</a>
      : <span key={label} className="icon-button" aria-disabled="true"><Icon name={icon} small />{label}</span>)}
  </nav>;
}

function Review({ assignment, roster, visible, filter, setFilter, detail, model, updateDetail, pane, setPane, paragraph, setParagraph, startQuestion }) {
  const { evidence } = detail;
  const status = statusOf(detail);
  function pick(index) {
    setParagraph(index);
    if (matchMedia('(max-width: 970px)').matches) setPane('proof');
  }
  return <div className="workbench-shell">
    <WorkbenchTop title="제출물 검토" context={detail.name + ' · ' + detail.config.title} back={href('roster')} backLabel="학생 제출 현황">
      <LinkButton to="question" id={detail.id} secondary compact>구술 질문</LinkButton>
      <LinkButton to="score" id={detail.id} compact>구술평가</LinkButton>
    </WorkbenchTop>
    <PaneTabs items={[['roster', '학생'], ['document', '제출물'], ['proof', 'AI 활용 근거']]} active={pane} onChange={setPane} />
    <div className="workbench-grid teacher-grid">
      <Pane id="roster" active={pane} className="rail" title="학생 목록" icon="users">
        <div className="pane-scroll rail-content">
          <p className="course-name">{contextOf(assignment)}</p>
          <Filters filter={filter} setFilter={setFilter} compact />
          <div aria-live="polite">{visible.length ? <ul className="rail-roster">{visible.map(row => {
            const body = <><span className="initial" aria-hidden="true">{row.name[0]}</span><span><strong>{row.name}</strong><small>{row.status}</small></span></>;
            return <li key={row.studentId}>{row.id
              ? <a className="roster-person" href={href('review', row.id)} aria-current={row.id === detail.id ? 'page' : undefined}
                onClick={() => setPane('document')}>{body}</a>
              : <div className="roster-person is-muted">{body}</div>}</li>;
          })}</ul> : <p className="muted small">조건에 맞는 학생이 없어요.</p>}</div>
        </div>
        <div className="rail-foot"><a className="icon-button" href={href('setup')}><Icon name="list" small />과제 설정</a></div>
      </Pane>
      <Pane id="document" active={pane} className="reader-pane" title="최종 제출물" icon="file"
        aside={<Pill tone={statusTone(status)}>{status}</Pill>}>
        <div className="pane-scroll paper-scroll">
          <article className="paper-sheet reader-paper">
            <h3 className="doc-title">{detail.title}</h3>
            <p className="reader-meta">{detail.name} · {when(detail.createdAt)} 제출 · 문단 {detail.paragraphs.length}</p>
            <ol className="reader-list">{detail.paragraphs.map((text, index) => {
              const linked = evidence.mode === 'shared' && evidence.paragraph === index;
              const asked = confirmedQuestion(detail)?.paragraph === index;
              return <li key={index}><button type="button" className="reader-paragraph" aria-pressed={paragraph === index} onClick={() => pick(index)}>
                <span className="paragraph-meta">문단 {index + 1}{linked && <Pill tone="amber">AI 활용 연결</Pill>}{asked && <Pill>구술 질문</Pill>}</span>
                <span className="paragraph-text">{linked ? <mark className="review-mark">{text}</mark> : text}</span>
              </button></li>;
            })}</ol>
          </article>
        </div>
        <Neighbors roster={roster} id={detail.id} />
      </Pane>
      <Pane id="proof" active={pane} className="inspector-pane" title="AI 활용 근거" icon="link"
        aside={<span className="meta">문단 {paragraph + 1}</span>}>
        <div className="pane-scroll inspect-content" aria-live="polite">
          <Inspector detail={detail} paragraph={paragraph} setParagraph={setParagraph} model={model}
            updateDetail={updateDetail} startQuestion={startQuestion} />
        </div>
      </Pane>
    </div>
  </div>;
}

function Inspector({ detail, paragraph, setParagraph, model, updateDetail, startQuestion }) {
  const { evidence } = detail;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const question = confirmedQuestion(detail);
  const candidates = detail.questions.filter(item => item.source === 'AI 추천' && item.paragraph === paragraph &&
    item.id !== question?.id && item.text !== question?.text);
  async function suggest() {
    setBusy(true);
    setMessage(null);
    try {
      updateDetail(await api('/submissions/' + detail.id + '/suggest', 'POST'));
      setMessage({ text: 'AI 질문 후보를 받았어요. 후보는 해당 문단을 선택하면 보여요.' });
    } catch (error) {
      setMessage({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }

  let report;
  if (evidence.mode === 'shared' && evidence.paragraph === paragraph) {
    report = <>
      <section className="inspect-block"><div className="row"><h3>문단 {paragraph + 1}의 공유 기록</h3><Pill>학생 직접 연결</Pill></div>
        <dl>{evidence.question && <div><dt>학생 질문</dt><dd>{evidence.question}</dd></div>}<div><dt>AI 답변</dt><dd>{evidence.excerpt}</dd></div></dl></section>
      <section className="inspect-block tint"><h3>학생의 활용 설명</h3><p className="plain-text">{evidence.explanation}</p></section>
    </>;
  } else if (evidence.mode === 'shared') {
    report = <section className="inspect-block"><h3>문단 {paragraph + 1}</h3><p className="muted">이 문단에 학생이 연결한 대화가 없어요.</p>
      <div className="case-jump"><button type="button" onClick={() => setParagraph(evidence.paragraph)}>문단 {evidence.paragraph + 1}의 연결 근거 보기</button></div></section>;
  } else {
    report = <section className="inspect-block"><h3>학생의 AI 활용 보고</h3><ReportSummary report={evidence} /></section>;
  }

  return <>
    {report}
    <section className="inspect-block"><h3>문연 과제 AI 사용 기록</h3>
      <p className={detail.modes.length ? '' : 'muted'}>{detail.modes.length
        ? '사용한 도움 유형: ' + detail.modes.map(mode => chatModes[mode]).join(' · ')
        : '문연 과제 AI를 사용한 기록이 없어요.'}</p>
      <p className="hint">학생이 표시하지 않은 대화 내용은 보이지 않아요.</p>
    </section>
    <section className="inspect-block"><h3>구술 질문</h3>
      {question && question.paragraph === paragraph
        ? <><p>{question.text}</p><a className="text-link" href={href('question', detail.id)}>저장된 질문 편집</a></>
        : question
          ? <p className="muted small">문단 {question.paragraph + 1}에 질문을 준비했어요. 이 문단으로 바꾸려면 새로 작성하세요.</p>
          : <p className="muted small">아직 준비한 질문이 없어요.</p>}
      {candidates.length > 0 && <details className="disclosure"><summary>AI 질문 후보 {candidates.length}개</summary>
        <ul className="candidate-list">{candidates.map(item => <li key={item.id}><p>{item.text}</p>
          <button className="icon-button" type="button" onClick={() => startQuestion(paragraph, item.text)}>이 후보로 시작</button></li>)}</ul>
      </details>}
      <Notice message={message} />
      <div className="inspect-actions">
        <button className="button compact" type="button" onClick={() => startQuestion(paragraph, question?.paragraph === paragraph ? question.text : '')}>
          {question?.paragraph === paragraph ? '질문 수정' : '이 문단으로 질문 작성'}</button>
        {model && <button className="button compact secondary" type="button" disabled={busy} onClick={suggest}>{busy ? '후보 받는 중…' : 'AI 질문 후보 받기'}</button>}
      </div>
    </section>
  </>;
}

function Question({ detail, pending, updateDetail }) {
  const current = confirmedQuestion(detail);
  const [paragraph, setParagraph] = useState(pending?.paragraph ?? current?.paragraph ?? 0);
  const [text, setText] = useState(pending?.text || current?.text || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const evaluated = detail.evaluation?.reason != null;
  const changed = current && (current.text !== text.trim() || current.paragraph !== paragraph);
  const candidates = detail.questions.filter(item => item.source === 'AI 추천' && item.paragraph === paragraph);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      updateDetail(await api('/submissions/' + detail.id + '/question', 'PUT', { paragraph, text }));
      setMessage({ text: '구술 질문을 저장했어요.' });
    } catch (error) {
      setMessage({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }
  return <>
    <Trail to={href('roster')}>학생 제출 현황</Trail>
    <Intro title="구술 질문" context={detail.name + ' · ' + detail.config.title} />
    <WorkTabs active="question" id={detail.id} />
    <form onSubmit={save}><div className="stack">
      <section className="card fields">
        <label>근거 문단<select value={paragraph} onChange={event => setParagraph(Number(event.target.value))}>
          {detail.paragraphs.map((part, index) => <option key={index} value={index}>문단 {index + 1} · {part.slice(0, 38)}</option>)}</select></label>
        <p className="excerpt">{detail.paragraphs[paragraph]}</p>
        <label>학생에게 물을 질문<textarea rows={4} required maxLength={1200} value={text}
          placeholder="예: 이 기준을 선택한 이유는 무엇인가요? 조건이 달라지면 판단도 바뀔까요?" onChange={event => setText(event.target.value)} /></label>
        {candidates.length > 0 && <details className="disclosure"><summary>이 문단의 AI 질문 후보 {candidates.length}개</summary>
          <ul className="candidate-list">{candidates.map(item => <li key={item.id}><p>{item.text}</p>
            <button className="icon-button" type="button" onClick={() => setText(item.text)}>이 후보 사용</button></li>)}</ul></details>}
      </section>
      {evaluated && changed && <p className="notice warn">저장하면 이미 기록한 구술평가({detail.evaluation.reason + detail.evaluation.transfer} / 4점)가 초기화돼요.</p>}
      <Notice message={message} />
    </div>
    <div className="actions">
      {current ? <LinkButton to="score" id={detail.id} secondary>구술평가 열기</LinkButton> : <span />}
      <button className="button" disabled={busy || (current && !changed)}>{evaluated && changed ? '평가 초기화하고 저장' : '구술 질문 저장'}</button>
    </div></form>
  </>;
}

function Score({ detail, roster, updateDetail }) {
  const question = confirmedQuestion(detail);
  const saved = detail.evaluation;
  const [scores, setScores] = useState({ reason: saved?.reason ?? null, transfer: saved?.transfer ?? null });
  const [memo, setMemo] = useState(saved?.memo ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const heading = <>
    <Trail to={href('roster')}>학생 제출 현황</Trail>
    <Intro title="구술평가" context={detail.name + ' · ' + detail.config.title} />
    <WorkTabs active="score" id={detail.id} />
  </>;
  if (!question) return <>{heading}
    <section className="card"><h2>저장된 구술 질문이 없어요</h2><p className="muted">질문을 준비하면 이 화면에서 평가를 기록할 수 있어요.</p></section>
    <div className="actions end"><LinkButton to="question" id={detail.id}>구술 질문 작성</LinkButton></div>
  </>;

  const total = scores.reason != null && scores.transfer != null ? scores.reason + scores.transfer : null;
  const nextRow = roster.find(row => row.id && row.id !== detail.id && row.status !== '평가 완료');
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      updateDetail(await api('/submissions/' + detail.id + '/evaluation', 'PUT', {
        questionId: question.id, questionText: question.text, ...scores, memo,
      }));
      setMessage({ text: `평가를 저장했어요 · ${total} / 4점` });
    } catch (error) {
      setMessage({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }
  return <>{heading}
    <form onSubmit={save}><div className="stack">
      <section className="card"><h2>저장된 질문</h2><p className="oral-question">{question.text}</p>
        <p className="excerpt">문단 {question.paragraph + 1} · {detail.paragraphs[question.paragraph]}</p></section>
      <section className="card fields">
        <div className="row"><h2>평가 기록</h2><p className="score-total" aria-live="polite">{total == null ? '– ' : total} <span>/ 4점</span></p></div>
        <p className="hint">{detail.config.rubric}</p>
        {criteria.map(([key, label]) => <fieldset key={key}><legend>{label}</legend><div className="scores">
          {[0, 1, 2].map(value => <label key={value}><input type="radio" name={key} value={value} required checked={scores[key] === value}
            onChange={() => setScores({ ...scores, [key]: value })} />{value}점</label>)}</div></fieldset>)}
        <label>평가 메모<textarea rows={3} maxLength={3000} value={memo} onChange={event => setMemo(event.target.value)} /></label>
      </section>
      <Notice message={message} />
    </div>
    <div className="actions">
      {nextRow ? <LinkButton to="review" id={nextRow.id} secondary>다음 학생 · {nextRow.name}</LinkButton> : <LinkButton to="roster" secondary>학생 목록으로</LinkButton>}
      <button className="button" disabled={busy}>평가 저장</button>
    </div></form>
  </>;
}

function Setup({ assignment, submitted, notice, onNext }) {
  function next(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    onNext(Object.fromEntries(new FormData(form)));
  }
  return <>
    <Intro title="과제 설정" subtitle="1단계 · 과제 정보와 평가 기준" context={assignment.course} />
    <form onSubmit={next}><div className="stack">
      <section className="card fields">
        <label>과제 제목<input name="title" maxLength={160} required defaultValue={assignment.title} /></label>
        <div className="field-row">
          <label>과목<input name="course" maxLength={160} required defaultValue={assignment.course} /></label>
          <label>분반 <span className="hint">선택</span><input name="section" maxLength={60} defaultValue={assignment.section} /></label>
        </div>
        <label>제출 마감 <span className="hint">한국 시간 기준</span><input type="datetime-local" name="due" defaultValue={assignment.due} /></label>
        <label>과제 안내<textarea name="prompt" rows={5} maxLength={1600} required defaultValue={assignment.prompt} /></label>
        <label>구술평가 기준 <span className="hint">평가 화면에 함께 표시돼요</span>
          <textarea name="rubric" rows={3} maxLength={1600} required defaultValue={assignment.rubric} /></label>
      </section>
      {submitted > 0 && <p className="notice warn">이미 제출한 {submitted}명의 제출물에는 제출 당시의 과제 설정이 보존돼요.</p>}
      <Notice message={notice} />
    </div>
    <div className="actions end"><button className="button">AI 활용 기준으로</button></div></form>
  </>;
}

function Policy({ assignment, onSaved }) {
  const [rules, setRules] = useState({ allowed: assignment.allowed, restricted: assignment.restricted });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      onSaved(await api('/assignment', 'PUT', { ...assignment, ...rules }));
    } catch (error) {
      setMessage({ text: error.message, error: true });
      setBusy(false);
    }
  }
  return <>
    <Trail to={href('setup')}>과제 설정</Trail>
    <Intro title="AI 활용 기준" subtitle="2단계 · 학생이 과제를 열면 이 기준이 표시돼요." context={assignment.title} />
    <form onSubmit={save}><div className="stack">
      <section className="card fields">
        <label>허용하는 도움<textarea rows={3} maxLength={500} value={rules.allowed} placeholder="예: 아이디어 구상, 초안 피드백"
          onChange={event => setRules({ ...rules, allowed: event.target.value })} /></label>
        <label>제한하는 도움<textarea rows={3} maxLength={500} value={rules.restricted} placeholder="예: 제출문 대필, 인터뷰 근거 생성"
          onChange={event => setRules({ ...rules, restricted: event.target.value })} /></label>
      </section>
      <section className="card tint" aria-label="학생 화면 미리보기"><p className="context">학생 화면 미리보기</p>
        <h2>이 과제의 AI 활용 기준</h2><Rules assignment={{ ...assignment, ...rules }} /></section>
      <Notice message={message} />
    </div>
    <div className="actions end"><button className="button" disabled={busy}>과제 설정 저장</button></div></form>
  </>;
}
