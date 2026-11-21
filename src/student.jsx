import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { clock, go, href, readBase64, remaining, replace, store, stored, uid, useRoute, useScreenFocus, when } from './lib.js';
import {
  ACTIVITIES, STAGES, USAGES, paragraphAt, paragraphRanges, relocate, segments, shiftItems, similarTurns,
} from '../shared/text.js';
import {
  Crumbs, Details, Dialog, Empty, Icon, Intro, Notice, Pane, PaneTabs, Pill, RulesTable, StageLegend, StagePill, WorkbenchTop,
} from './ui.jsx';
import { Shell } from './shell.jsx';

const accept = '.txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function statusOf(entry) {
  if (!entry.open) return entry.versionNo ? [entry.versionNo + '회차 제출 · 마감', ''] : ['마감 · 미제출', 'neutral'];
  if (entry.versionNo) return [entry.versionNo + '회차 제출됨', ''];
  return [entry.draftAt ? '작성 중' : '시작 전', 'neutral'];
}

export function StudentApp({ session, onLogout }) {
  const route = useRoute();
  const [list, setList] = useState(null);
  const [failure, setFailure] = useState(null);
  const landed = useRef(false);
  const refreshList = useCallback(() => api('/my/assignments').then(result => setList(result.items))
    .catch(error => setFailure(error.message)), []);
  useEffect(() => { refreshList(); }, [refreshList]);

  const [area, rawId, view = 'write'] = route.parts;
  const id = area === 'a' ? Number(rawId) : null;
  // 데스크톱에서는 마감이 가장 가까운 진행 중 과제의 작업실로 바로 연다.
  useEffect(() => {
    if (!list || landed.current) return;
    landed.current = true;
    if (!area && matchMedia('(min-width: 971px)').matches) {
      const due = entry => entry.deadlineAt ? Date.parse(entry.deadlineAt) : Infinity;
      const next = list.filter(entry => entry.open).sort((a, b) => due(a) - due(b))[0] ?? list[0];
      if (next) replace('a', next.id);
    }
  }, [list, area]);

  let content;
  if (failure) content = <Notice message={{ text: failure, error: true }} />;
  else if (!list) content = <p className="muted" role="status">과제를 불러오는 중…</p>;
  else if (!id) content = <Home list={list} />;
  else content = <Room key={id} id={id} view={view} list={list} model={session.model} refreshList={refreshList} />;
  return <Shell session={session} home={href('list')} onLogout={onLogout} workbench={Boolean(id) && view === 'write'}>{content}</Shell>;
}

function groupByCourse(list) {
  const groups = new Map();
  for (const entry of list) {
    if (!groups.has(entry.courseId)) groups.set(entry.courseId, { name: entry.courseName, section: entry.sectionName, items: [] });
    groups.get(entry.courseId).items.push(entry);
  }
  return [...groups.values()];
}

function Home({ list }) {
  useScreenFocus('home');
  if (!list.length) return <><Intro title="내 과제" /><Empty title="아직 공개된 과제가 없어요">담당 교수자가 과제를 공개하면 여기에 표시돼요.</Empty></>;
  return <>
    <Intro title="내 과제" subtitle="과목별로 공개된 과제예요." />
    <div className="stack">{groupByCourse(list).map(group => <section key={group.name} className="card">
      <h2>{group.name} <span className="muted small">{group.section}</span></h2>
      <ul className="link-list">{group.items.map(entry => {
        const [label, tone] = statusOf(entry);
        return <li key={entry.id}><a href={href('a', entry.id)}>
          <span><strong>{entry.title}</strong><small>마감 {when(entry.deadlineAt)}{entry.open && entry.deadlineAt ? ' · ' + remaining(entry.deadlineAt) : ''}</small></span>
          <Pill tone={tone}>{label}</Pill></a></li>;
      })}</ul>
    </section>)}</div>
  </>;
}

// 과제 하나의 작업실·제출 준비·제출 확인·제출 이력을 함께 관리한다.
function Room({ id, view, list, model, refreshList }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [meta, setMeta] = useState({ file: null, editedAfterUpload: false });
  const [saved, setSaved] = useState({ state: 'idle', at: null });
  const [failure, setFailure] = useState(null);
  const dirty = useRef(false);
  const revision = useRef(0);
  const timer = useRef(null);
  const saving = useRef(null);

  useEffect(() => {
    Promise.all([api('/assignments/' + id), api(`/assignments/${id}/chat`), api(`/assignments/${id}/draft`), api(`/assignments/${id}/submission`)])
      .then(([assignment, chat, stored, { submission }]) => {
        setData({ assignment, turns: chat.items, submission });
        revision.current = stored.revision;
        setDraft({ title: stored.title, body: stored.body, items: stored.items, objections: stored.objections, noAi: stored.noAi, fileId: stored.file?.id ?? null });
        setMeta({ file: stored.file, editedAfterUpload: stored.editedAfterUpload });
        setSaved({ state: 'idle', at: stored.updatedAt });
      })
      .catch(error => setFailure(error));
  }, [id]);

  const save = useCallback(async current => {
    dirty.current = false;
    setSaved(state => ({ ...state, state: 'saving' }));
    try {
      const result = await api(`/assignments/${id}/draft`, 'PUT', { ...current, revision: revision.current });
      revision.current = result.revision;
      setMeta({ file: result.file, editedAfterUpload: result.editedAfterUpload });
      setSaved({ state: 'saved', at: result.updatedAt });
    } catch (error) {
      dirty.current = error.code !== 'REVISION_CONFLICT';
      setSaved(state => ({ ...state, state: 'error', message: error.message, conflict: error.code === 'REVISION_CONFLICT' }));
      throw error;
    }
  }, [id]);

  // 입력을 멈추고 0.7초가 지나면 저장한다.
  useEffect(() => {
    if (!draft || !dirty.current) return;
    setSaved(state => ({ ...state, state: 'pending' }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { saving.current = save(draft).catch(() => {}); }, 700);
    return () => clearTimeout(timer.current);
  }, [draft, save]);
  useEffect(() => {
    const warn = event => { if (dirty.current) event.preventDefault(); };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, []);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    await saving.current;
    if (dirty.current) await save(draft);
  }, [draft, save]);

  const change = useCallback(values => {
    dirty.current = true;
    setDraft(current => {
      const next = { ...current, ...values };
      if (values.body !== undefined && values.body !== current.body && !values.items) next.items = shiftItems(current.items, current.body, values.body);
      return next;
    });
  }, []);
  const updateItem = useCallback((itemId, values) => change({ items: draft.items.map(item => item.id === itemId ? { ...item, ...values } : item) }), [change, draft]);

  useScreenFocus(id + view);
  if (failure) return <><Crumbs items={[['내 과제', href('list')], ['과제']]} /><Notice message={{ text: failure.message, error: true }} /></>;
  if (!data || !draft) return <p className="muted" role="status">과제를 여는 중…</p>;
  const props = { id, list, model, data, setData, draft, change, updateItem, saved, meta, flush, revision, refreshList };
  if (view === 'info') return <Info {...props} />;
  if (view === 'prepare') return <Prepare {...props} />;
  if (view === 'confirm') return <Confirm {...props} />;
  if (view === 'history') return <History {...props} />;
  return <Workbench {...props} />;
}

function saveLabel(saved) {
  if (saved.state === 'pending' || saved.state === 'saving') return '저장 중…';
  if (saved.state === 'error') return saved.message;
  return saved.at ? '저장됨 · ' + clock(saved.at) : '편집하면 자동 저장';
}
const draftDiffers = (submission, draft) => submission && (submission.version.body !== draft.body || submission.version.title !== draft.title);

function useAutosize(value, deps) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field || !field.offsetWidth) return;
    field.style.height = 'auto';
    field.style.height = field.scrollHeight + 1 + 'px';
  }, [value, ...deps]);
  return ref;
}

function Workbench({ id, list, model, data, setData, draft, change, updateItem, saved, meta }) {
  const { assignment, turns, submission } = data;
  const readOnly = !assignment.open;
  const [pane, setPane] = useState('editor');
  const [selected, setSelected] = useState([]);
  const [connecting, setConnecting] = useState(null);
  const [status, setStatus] = useState('');
  const [sidebar, setSidebar] = useState(() => stored('sidebar-open', true));
  const bodyRef = useRef(null);
  const toggleSidebar = () => { setSidebar(!sidebar); store('sidebar-open', !sidebar); };

  function startConnect(target = null) {
    setConnecting(target ?? { turnIds: selected });
    setPane('editor');
    setStatus('');
    requestAnimationFrame(() => bodyRef.current?.focus());
  }
  function connect(target = connecting ?? { turnIds: selected }) {
    const field = bodyRef.current;
    let start = field.selectionStart;
    let end = field.selectionEnd;
    if (start === end) {
      const paragraph = paragraphAt(draft.body, start);
      if (!paragraph) { setStatus('먼저 본문을 입력하세요.'); return; }
      ({ start, end } = paragraph);
    }
    while (start < end && /\s/.test(draft.body[start])) start++;
    while (end > start && /\s/.test(draft.body[end - 1])) end--;
    if (end <= start) { setStatus('연결할 문장을 선택하세요.'); return; }
    const range = { start, end, quote: draft.body.slice(start, end), status: 'ok' };
    const paragraph = paragraphAt(draft.body, start).index + 1;
    if (target.itemId) {
      updateItem(target.itemId, range);
      setStatus(`문단 ${paragraph}로 위치를 다시 지정했어요.`);
    } else {
      const linked = target.turnIds.map(turnId => turns.find(turn => turn.id === turnId)).filter(Boolean);
      change({ items: [...draft.items, { id: uid(), ...range, turnIds: linked.map(turn => turn.id), stage: linked[0]?.stage ?? 's1',
        usage: linked.length ? 'reworked' : 'idea', explanation: '' }] });
      setSelected([]);
      setStatus(`문단 ${paragraph}에 활용 기록을 추가했어요. 아래 목록에서 설명을 적어 주세요.`);
    }
    setConnecting(null);
  }

  const changed = draftDiffers(submission, draft);
  const lost = draft.items.filter(item => item.status === 'lost').length;
  return <div className="workbench-shell">
    <WorkbenchTop title={assignment.title} back={href('list')} backLabel="내 과제 목록"
      context={`${assignment.courseName} · ${assignment.sectionName} · 마감 ${when(assignment.deadlineAt)}${assignment.open && assignment.deadlineAt ? ' (' + remaining(assignment.deadlineAt) + ')' : ''}`}>
      {submission && <Pill tone={changed ? 'amber' : ''}>{submission.version.no}회차 제출됨{changed ? ' · 수정 중' : ''}</Pill>}
      {!readOnly && <span className={'save-indicator' + (saved.state === 'error' ? ' failed' : '')}>
        <Icon name={saved.state === 'error' ? 'alert' : 'check'} small /><span role="status">{saveLabel(saved)}</span>
        {saved.conflict && <button type="button" className="text-link" onClick={() => location.reload()}>새로고침</button>}</span>}
      <a className="button compact secondary" href={href('a', id, 'info')}>과제 안내</a>
      {submission && <a className="button compact secondary" href={href('a', id, 'history')}>제출 이력</a>}
      {!readOnly && <a className="button compact" href={href('a', id, 'prepare')}>{submission ? '다시 제출 준비' : '제출 준비'}</a>}
    </WorkbenchTop>
    {readOnly && <p className="banner">{assignment.status === 'closed' ? '교수자가 마감한 과제예요.' : '제출 마감이 지났어요.'} 작성한 내용은 읽기 전용으로 볼 수 있어요.</p>}
    <PaneTabs items={[['assignments', '과제 목록'], ['chat', model ? '과제 AI' : 'AI 기준'], ['editor', '문서']]} active={pane} onChange={setPane} />
    <div className={'workbench-grid student-grid' + (sidebar ? '' : ' rail-closed')}>
      <Sidebar id={id} list={list} open={sidebar} toggle={toggleSidebar} pane={pane} />
      <Chat id={id} assignment={assignment} turns={turns} items={draft.items} model={model} readOnly={readOnly} pane={pane}
        selected={selected} setSelected={setSelected} onConnect={() => startConnect()}
        addTurn={turn => setData(current => ({ ...current, turns: [...current.turns.filter(item => item.id !== turn.id), turn] }))} body={draft.body} />
      <Pane id="editor" active={pane} className="editor-pane" title="문서" icon="file"
        aside={<span className="meta">활용 기록 {draft.items.length}{lost ? ' · 위치 확인 ' + lost : ''}</span>}>
        <Editor id={id} assignment={assignment} draft={draft} change={change} updateItem={updateItem} meta={meta} turns={turns}
          readOnly={readOnly} bodyRef={bodyRef} connecting={connecting} setConnecting={setConnecting} connect={connect}
          startConnect={startConnect} status={status} setStatus={setStatus} pane={pane} />
      </Pane>
    </div>
  </div>;
}

function Sidebar({ id, list, open, toggle, pane }) {
  if (!open) {
    return <aside className="pane rail rail-collapsed" id="pane-assignments" data-pane-active={pane === 'assignments'} aria-label="과제 목록">
      <button type="button" className="icon-button" onClick={toggle} aria-label="과제 목록 펼치기" title="과제 목록 펼치기"><Icon name="panel" /></button>
    </aside>;
  }
  return <Pane id="assignments" active={pane} className="rail" title="내 과제" icon="list"
    aside={<button type="button" className="icon-button rail-toggle" onClick={toggle} aria-label="과제 목록 접기" title="과제 목록 접기"><Icon name="panel" small /></button>}>
    <div className="pane-scroll rail-content">
      {groupByCourse(list).map(group => <div key={group.name} className="stack tight">
        <p className="course-name">{group.name} · {group.section}</p>
        {group.items.map(entry => {
          const [label] = statusOf(entry);
          return <a key={entry.id} className="rail-link" href={href('a', entry.id)} aria-current={entry.id === id ? 'page' : undefined}>
            <Icon name="file" small /><span><strong>{entry.title}</strong><small>{label} · {remaining(entry.deadlineAt) || '마감 미정'}</small></span>
          </a>;
        })}
      </div>)}
    </div>
  </Pane>;
}

function Chat({ id, assignment, turns, items, model, readOnly, pane, selected, setSelected, onConnect, addTurn, body }) {
  const [stage, setStage] = useState(() => stored('stage-' + id, 's1'));
  const [activity, setActivity] = useState('ideas');
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const scroll = useRef(null);
  const decision = assignment.rules[stage]?.[activity];
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [turns.length, pending, pane]);
  useEffect(() => { store('stage-' + id, stage); }, [id, stage]);

  async function send(request) {
    setPending(request);
    setError(null);
    try {
      addTurn(await api(`/assignments/${id}/chat`, 'POST', request));
      setQuestion('');
      setPending(null);
    } catch (failure) {
      setError({ message: failure.message, request });
      setPending(null);
    }
  }
  function submit(event) {
    event.preventDefault();
    const text = question.trim();
    if (text && !pending) send({ clientRequestId: uid(), stage, activity, text });
  }
  const toggle = turnId => setSelected(selected.includes(turnId) ? selected.filter(item => item !== turnId) : [...selected, turnId]);
  const linksOf = turnId => items.filter(item => item.turnIds.includes(turnId));

  return <Pane id="chat" active={pane} className="chat-pane" title={model ? '과제 AI' : 'AI 활용 기준'} icon="chat"
    aside={model ? <span className="meta">대화 {turns.length}</span> : <span className="meta">AI 대화 꺼짐</span>}>
    <div className="pane-scroll chat-body" ref={scroll}>
      <details className="chat-rules disclosure"><summary>이 과제의 AI 활용 기준</summary>
        <RulesTable stages={assignment.stages} rules={assignment.rules} compact /></details>
      {turns.length || pending ? <ol className="chat-stream" aria-label="AI 대화">
        {turns.map(turn => {
          const links = linksOf(turn.id);
          return <li className={'chat-turn' + (selected.includes(turn.id) ? ' is-selected' : '')} key={turn.id}>
            <div className="chat-message mine"><span className="turn-meta"><StagePill stages={assignment.stages} stage={turn.stage} />{ACTIVITIES[turn.activity]}</span>{turn.prompt}</div>
            <div className={'chat-message ai' + (turn.action === 'restricted' ? ' restricted' : '')}>
              <strong><Icon name="star" small />과제 AI{turn.action === 'restricted' && <Pill tone="amber">제한된 요청 · 힌트로 안내</Pill>}
                {turn.action === 'hinted' && <Pill tone="amber">기준 확인 필요 · 힌트로 안내</Pill>}</strong>{turn.reply}</div>
            <div className="chat-select">
              {!readOnly && <label className="check-chip"><input type="checkbox" checked={selected.includes(turn.id)} onChange={() => toggle(turn.id)} />선택</label>}
              {links.map(item => <span key={item.id} className="link-chip">
                <Icon name="link" small />{item.start == null ? '미반영 기록' : '문단 ' + ((paragraphAt(body, item.start)?.index ?? 0) + 1)}</span>)}
            </div>
          </li>;
        })}
        {pending && <li className="chat-turn"><div className="chat-message mine">{pending.text}</div><p className="chat-pending" role="status">답변을 준비하고 있어요…</p></li>}
      </ol> : <p className="chat-empty">{model
        ? '과제에 대해 궁금한 점을 물어보세요. 대화는 저장되고, 문서에 연결한 대화와 자동으로 찾은 유사 대화, 기준 확인이 필요한 대화만 제출 후 교수자에게 보여요.'
        : '이 서버에서는 과제 AI 대화를 쓰지 않아요. 다른 AI 도구를 활용했다면 문서에서 해당 부분을 선택해 활용 기록을 남겨 주세요.'}</p>}
    </div>
    {selected.length > 0 && <div className="selection-bar" role="status">
      <span>대화 {selected.length}개 선택</span>
      <button type="button" className="text-link" onClick={() => setSelected([])}>선택 해제</button>
      <button type="button" className="button compact" onClick={onConnect}><Icon name="link" small />문서에 연결</button>
    </div>}
    {model && !readOnly && <div className="chat-compose">
      <div className="compose-options">
        <label className="inline-field">지금 단계<select value={stage} onChange={event => setStage(event.target.value)}>
          {STAGES.map(key => <option key={key} value={key}>{assignment.stages[key]}</option>)}</select></label>
        <div className="prompt-list" role="group" aria-label="도움 유형">
          {Object.entries(ACTIVITIES).map(([key, label]) => <button key={key} type="button" aria-pressed={activity === key}
            onClick={() => setActivity(key)}>{label}</button>)}
        </div>
      </div>
      {decision === 'restricted' && <p className="hint warn-text">이 단계에서 ‘{ACTIVITIES[activity]}’은(는) 제한된 도움이에요. 보내면 답 대신 힌트로 안내하고, 교수자 확인 항목에 기록돼요.</p>}
      {error && <p className="notice error">{error.message} <button type="button" className="text-link" onClick={() => send(error.request)}>다시 시도</button></p>}
      <form className="composer" onSubmit={submit}>
        <input aria-label="AI에게 질문" placeholder="과제에 대해 질문하기" maxLength={3000} required
          value={question} onChange={event => setQuestion(event.target.value)} readOnly={Boolean(pending)} />
        <button type="submit" className="button" aria-label="질문 보내기" title="질문 보내기" disabled={Boolean(pending) || !question.trim()}><Icon name="send" /></button>
      </form>
    </div>}
  </Pane>;
}

function Highlighted({ body, items }) {
  return <div className="doc-highlights" aria-hidden="true">
    {segments(body, items).map(part => part.items.length
      ? <mark key={part.start} className={'stage-mark stage-' + part.items.at(-1).stage}>{part.text}</mark>
      : <span key={part.start}>{part.text}</span>)}{'​'}
  </div>;
}

function Editor({ id, assignment, draft, change, updateItem, meta, turns, readOnly, bodyRef, connecting, setConnecting, connect, startConnect, status, setStatus, pane }) {
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const titleRef = useAutosize(draft.title, [pane]);
  const autosize = useAutosize(draft.body, [pane]);
  const setBody = node => { bodyRef.current = node; autosize.current = node; };
  const count = paragraphRanges(draft.body).length;

  async function upload(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setStatus('10 MB 이하의 파일을 올려 주세요.'); return; }
    setUploading(true);
    setStatus(file.name + ' · 텍스트로 변환하는 중…');
    try {
      const result = await api(`/assignments/${id}/draft/import`, 'POST', { fileName: file.name, data: await readBase64(file) });
      setPreview(result);
      setStatus('');
    } catch (failure) {
      setStatus(failure.message);
    } finally {
      setUploading(false);
    }
  }
  function apply() {
    const items = draft.items.map(item => relocate(item, preview.text));
    change({ body: preview.text, fileId: preview.file.id, items });
    const lost = items.filter(item => item.status === 'lost').length;
    setStatus(preview.file.name + ' · 본문에 반영했어요.' + (lost ? ` 활용 기록 ${lost}개는 위치를 다시 지정해야 해요.` : ''));
    setPreview(null);
  }

  return <div className="editor-form">
    {!readOnly && <div className="editor-tools">
      <label className="icon-button file-button"><Icon name="attach" small />{uploading ? '변환 중…' : '파일 올리기'}
        <input type="file" accept={accept} onChange={upload} disabled={uploading} /></label>
      <span className="hint">.txt · .pdf · .docx</span>
      <button className="icon-button" type="button" onMouseDown={event => event.preventDefault()} onClick={() => connect()}>
        <Icon name="link" small />선택 부분에 활용 기록</button>
    </div>}
    {connecting && <div className="connect-banner" role="status">
      <p>{connecting.itemId ? '이 기록을 연결할 문장을 다시 선택하세요.'
        : connecting.turnIds.length ? `대화 ${connecting.turnIds.length}개를 연결할 문장을 드래그하거나, 커서를 문단에 두세요.`
          : '외부 AI 도구 등으로 도움받은 문장을 드래그하거나, 커서를 문단에 두세요.'}</p>
      <div><button type="button" className="button compact" onMouseDown={event => event.preventDefault()} onClick={() => connect()}>이 부분에 연결</button>
        <button type="button" className="button compact secondary" onClick={() => setConnecting(null)}>취소</button></div>
    </div>}
    <div className="pane-scroll paper-scroll">
      <article className="paper-sheet">
        {meta.file && <p className="file-note"><Icon name="attach" small />{meta.file.name}{meta.editedAfterUpload && <Pill tone="amber">업로드 후 수정됨</Pill>}
          {!readOnly && <button type="button" className="text-link" onClick={() => change({ fileId: null })}>원본 파일 연결 해제</button>}</p>}
        <label className="doc-label" htmlFor="doc-title">제목</label>
        <textarea ref={titleRef} className="doc-title" id="doc-title" rows={1} maxLength={160} readOnly={readOnly}
          placeholder="제출물 제목을 입력하세요" value={draft.title} onChange={event => change({ title: event.target.value.replace(/\n/g, ' ') })} />
        <hr className="doc-rule" />
        <label className="doc-label" htmlFor="doc-body">본문</label>
        <div className={'doc-body-wrap' + (connecting ? ' is-connecting' : '')}>
          <Highlighted body={draft.body} items={draft.items} />
          <textarea ref={setBody} className="doc-body" id="doc-body" rows={7} maxLength={60000} readOnly={readOnly}
            placeholder="본문을 입력하거나 파일을 올리세요. 한 줄을 비우면 새 문단이 돼요." value={draft.body}
            onChange={event => change({ body: event.target.value })} />
        </div>
        {draft.items.length > 0 && <StageLegend stages={assignment.stages} />}
      </article>
      <section className="item-section" aria-labelledby="items-title">
        <h3 id="items-title">이 문서의 AI 활용 기록 <span className="muted small">{draft.items.length}개</span></h3>
        {draft.items.length ? <ul className="item-list">{draft.items.map(item => <li key={item.id}>
          <ItemCard item={item} assignment={assignment} turns={turns} body={draft.body} readOnly={readOnly}
            onChange={values => updateItem(item.id, values)} onRemove={() => change({ items: draft.items.filter(entry => entry.id !== item.id) })}
            onRelink={() => startConnect({ itemId: item.id })} />
        </li>)}</ul> : <p className="muted small">대화에서 ‘선택’ 후 ‘문서에 연결’을 누르거나, 본문을 선택하고 ‘선택 부분에 활용 기록’을 누르면 여기에 쌓여요.</p>}
      </section>
    </div>
    <div className="doc-status"><span role="status">{status}</span><span>문단 {count} · {draft.body.length.toLocaleString('ko-KR')}자</span></div>
    <Dialog open={Boolean(preview)} title="변환 결과 확인" onClose={() => setPreview(null)}
      actions={<><button type="button" className="button secondary" onClick={() => setPreview(null)}>취소</button>
        <button type="button" className="button" onClick={apply}>본문에 반영</button></>}>
      {preview && <>
        <p className="muted small">{preview.file.name} · 문단 {paragraphRanges(preview.text).length}개로 나뉘었어요. 문단이 잘못 나뉘었다면 여기서 빈 줄을 넣거나 지워 고쳐 주세요.</p>
        {draft.body.trim() && <p className="notice warn">지금 본문이 파일 내용으로 바뀌어요. 활용 기록은 같은 문장을 찾아 다시 연결해요.</p>}
        <textarea className="preview-text" rows={14} value={preview.text} onChange={event => setPreview({ ...preview, text: event.target.value })} />
        <p className="hint">원본 파일은 함께 보관돼 교수자가 내려받을 수 있어요.</p>
      </>}
    </Dialog>
  </div>;
}

function ItemCard({ item, assignment, turns, body, readOnly, onChange, onRemove, onRelink }) {
  const linked = item.turnIds.map(turnId => turns.find(turn => turn.id === turnId)).filter(Boolean);
  const where = item.status === 'lost' ? null : item.start == null ? '문서에 반영하지 않음' : '문단 ' + ((paragraphAt(body, item.start)?.index ?? 0) + 1);
  return <article className={'item-card stage-edge-' + item.stage + (item.status === 'lost' ? ' is-lost' : '')}>
    <header className="item-head">
      <StagePill stages={assignment.stages} stage={item.stage} />
      <span className="muted small">{where ?? '위치 확인 필요'}{' · '}{linked.length ? '문연 대화 ' + linked.length + '개' : '외부 AI·직접 기록'}</span>
      {!readOnly && <button type="button" className="icon-button" aria-label="활용 기록 삭제" title="삭제" onClick={onRemove}><Icon name="trash" small /></button>}
    </header>
    {item.status === 'lost'
      ? <p className="notice warn">본문이 바뀌어 연결한 문장을 찾지 못했어요. <q>{item.quote.slice(0, 60)}</q>
        {!readOnly && <button type="button" className="text-link" onClick={onRelink}>위치 다시 지정</button>}</p>
      : item.quote && <blockquote className="item-quote">{item.quote}</blockquote>}
    {linked.length > 0 && <details className="disclosure small"><summary>연결한 대화 보기</summary>
      <ul className="turn-excerpts">{linked.map(turn => <li key={turn.id}><strong>나</strong> {turn.prompt}<br /><strong>AI</strong> {turn.reply}</li>)}</ul></details>}
    <div className="item-fields">
      <label>단계<select value={item.stage} disabled={readOnly} onChange={event => onChange({ stage: event.target.value })}>
        {STAGES.map(key => <option key={key} value={key}>{assignment.stages[key]}</option>)}</select></label>
      <label>활용 방식<select value={item.usage} disabled={readOnly} onChange={event => onChange({ usage: event.target.value })}>
        {Object.entries(USAGES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <label className="item-explain">무엇을 받아들이고 무엇을 바꿨나요?
      <textarea rows={2} maxLength={2000} readOnly={readOnly} value={item.explanation} placeholder="예: 비교 방법은 참고했고, 측정 항목은 관찰 결과에 맞게 직접 정했어요."
        onChange={event => onChange({ explanation: event.target.value })} /></label>
  </article>;
}

function Info({ id, data }) {
  const { assignment } = data;
  return <>
    <Crumbs items={[['내 과제', href('list')], [assignment.title, href('a', id)], ['과제 안내']]} />
    <Intro title={assignment.title} context={assignment.courseName + ' · ' + assignment.sectionName}
      subtitle={`마감 ${when(assignment.deadlineAt)}${assignment.open && assignment.deadlineAt ? ' · ' + remaining(assignment.deadlineAt) : ''}`} />
    <div className="stack">
      <section className="card"><h2>과제 안내</h2><p className="plain-text">{assignment.instructions || '등록된 안내가 없어요.'}</p>
        {assignment.materials.length > 0 && <p className="muted small material">과제 AI가 참고하는 강의자료: {assignment.materials.map(item => item.name).join(', ')}</p>}</section>
      <section className="card tint"><h2>AI 활용 기준</h2>
        <p className="muted small">단계마다 허용하는 도움이 달라요. 제한된 도움을 요청하면 답 대신 힌트로 안내하고, 교수자 확인 항목에 기록돼요.</p>
        <RulesTable stages={assignment.stages} rules={assignment.rules} /></section>
      <section className="card"><h2>교수자에게 공개되는 범위</h2>
        <ul className="plain-list">
          <li>제출한 문서와 AI 활용 기록, 기록에 연결한 대화 원문</li>
          <li>제출 시 자동으로 찾은 ‘AI 대화와 유사한 문단’ 결과와 내가 남긴 이의 내용</li>
          <li>제한된 도움을 요청했거나 기준 확인이 필요한 대화</li>
        </ul>
        <p className="hint">그 밖의 대화는 교수자 화면에 표시되지 않아요. 서버에는 저장돼요.</p></section>
    </div>
    <div className="actions end"><a className="button" href={href('a', id)}>작업실로</a></div>
  </>;
}

function Prepare({ id, data, draft, change, updateItem }) {
  const { assignment, turns } = data;
  const [adding, setAdding] = useState(null);
  const [objecting, setObjecting] = useState(null);
  const suggestions = useMemo(() => similarTurns(draft.body, turns.filter(turn => turn.action !== 'restricted'), draft.items), [draft.body, draft.items, turns]);
  const objections = new Map(draft.objections.map(entry => [entry.key, entry.reason]));
  const problems = [
    !draft.title.trim() && '제목을 입력해 주세요.',
    !draft.body.trim() && '본문을 입력해 주세요.',
    draft.items.some(item => item.status === 'lost') && '위치를 다시 지정해야 하는 활용 기록이 있어요.',
    draft.items.some(item => !item.explanation.trim()) && '모든 활용 기록에 설명을 적어 주세요.',
    !draft.items.length && !draft.noAi && 'AI 활용 내용을 기록하거나, 사용하지 않았다고 확인해 주세요.',
  ].filter(Boolean);
  if (!assignment.open) return <><Crumbs items={[['내 과제', href('list')], [assignment.title, href('a', id)], ['제출 준비']]} /><Empty title="마감된 과제예요" /></>;

  function addUnused(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const turnIds = form.getAll('turn').map(Number);
    if (adding === 'unused' && !turnIds.length) return;
    const first = turns.find(turn => turn.id === turnIds[0]);
    change({ items: [...draft.items, { id: uid(), start: null, end: null, quote: '', turnIds, stage: first?.stage ?? 's1',
      usage: adding === 'unused' ? 'not_adopted' : 'idea', explanation: String(form.get('explanation') ?? '') }], noAi: false });
    setAdding(null);
  }
  function linkSuggestion(match) {
    const turn = turns.find(entry => entry.id === match.turnId);
    change({ items: [...draft.items, { id: uid(), start: match.start, end: match.end, quote: draft.body.slice(match.start, match.end), status: 'ok',
      turnIds: [match.turnId], stage: turn.stage, usage: 'reworked', explanation: '' }], noAi: false });
  }
  function saveObjection(event) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason')).trim();
    change({ objections: [...draft.objections.filter(entry => entry.key !== objecting), ...(reason ? [{ key: objecting, reason }] : [])] });
    setObjecting(null);
  }

  return <>
    <Crumbs items={[['내 과제', href('list')], [assignment.title, href('a', id)], ['제출 준비']]} />
    <Intro title="제출 준비" subtitle="AI 활용 기록을 확인하고 설명을 채워 주세요." context={assignment.courseName + ' · ' + assignment.title} />
    <div className="stack">
      <section className="card stack">
        <div className="row adapt"><h2>AI 활용 기록 <span className="muted small">{draft.items.length}개</span></h2>
          <div className="tags"><button type="button" className="button compact secondary" onClick={() => setAdding('unused')} disabled={!turns.length}>검토 후 반영하지 않은 대화 추가</button>
            <button type="button" className="button compact secondary" onClick={() => setAdding('external')}>외부 AI 활용 기록</button></div></div>
        {adding && <form className="add-form" onSubmit={addUnused}>
          {adding === 'unused' ? <fieldset><legend>반영하지 않은 대화를 고르세요</legend>
            <ul className="turn-choices">{turns.map(turn => <li key={turn.id}><label className="choice"><input type="checkbox" name="turn" value={turn.id} />
              <span><StagePill stages={assignment.stages} stage={turn.stage} /> {turn.prompt.slice(0, 80)}</span></label></li>)}</ul></fieldset>
            : <p className="muted small">문서 특정 부분과 관련 있다면 작업실에서 해당 문장을 선택해 기록하는 편이 좋아요.</p>}
          <label className="item-explain">{adding === 'unused' ? '반영하지 않은 이유' : '어떤 도구로 무엇을 도움받았나요?'}
            <textarea name="explanation" rows={2} maxLength={2000} required /></label>
          <div className="tags"><button className="button compact">추가</button><button type="button" className="button compact secondary" onClick={() => setAdding(null)}>취소</button></div>
        </form>}
        {draft.items.length ? <ul className="item-list">{draft.items.map(item => <li key={item.id}>
          <ItemCard item={item} assignment={assignment} turns={turns} body={draft.body} onChange={values => updateItem(item.id, values)}
            onRemove={() => change({ items: draft.items.filter(entry => entry.id !== item.id) })} onRelink={() => go('a', id)} />
        </li>)}</ul> : <label className="choice no-ai"><input type="checkbox" checked={draft.noAi} onChange={event => change({ noAi: event.target.checked })} />
          <span>이 과제에서 AI를 사용하지 않았어요.</span></label>}
      </section>
      <section className="card stack">
        <h2>자동으로 찾은 유사한 대화 <span className="muted small">{suggestions.length}건</span></h2>
        <p className="muted small">문단과 내 대화의 표현이 겹치는 곳을 찾은 결과예요. AI가 문장을 썼다는 판단이 아니며, 제출하면 교수자에게 함께 보여요. 내 활용이 맞으면 연결하고, 아니라면 이유를 남길 수 있어요.</p>
        {suggestions.length ? <ul className="item-list">{suggestions.map(match => {
          const turn = turns.find(entry => entry.id === match.turnId);
          return <li key={match.key} className="suggestion">
            <p className="small"><strong>문단 {match.paragraph + 1}</strong> · 겹침 {Math.round(match.score * 100)}%</p>
            <blockquote className="item-quote">{draft.body.slice(match.start, match.end).slice(0, 160)}</blockquote>
            <p className="small muted">대화: {turn.prompt.slice(0, 80)}</p>
            {objections.has(match.key) && <p className="notice">이의: {objections.get(match.key)}</p>}
            {objecting === match.key ? <form className="add-form" onSubmit={saveObjection}>
              <label className="item-explain">관련이 없다고 보는 이유<textarea name="reason" rows={2} maxLength={1000} defaultValue={objections.get(match.key) ?? ''} /></label>
              <div className="tags"><button className="button compact">저장</button><button type="button" className="button compact secondary" onClick={() => setObjecting(null)}>취소</button></div>
            </form> : <div className="tags"><button type="button" className="button compact secondary" onClick={() => linkSuggestion(match)}>내 활용으로 연결</button>
              <button type="button" className="button compact secondary" onClick={() => setObjecting(match.key)}>{objections.has(match.key) ? '이의 수정' : '관련 없음 · 이유 남기기'}</button></div>}
          </li>;
        })}</ul> : <p className="muted small">연결하지 않은 유사 대화가 없어요.</p>}
      </section>
      {problems.length > 0 && <ul className="notice warn problem-list">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
    </div>
    <div className="actions"><a className="button secondary" href={href('a', id)}>작업실로</a>
      <a className="button" href={href('a', id, 'confirm')} aria-disabled={problems.length > 0}
        onClick={event => { if (problems.length) event.preventDefault(); }}>제출 확인으로</a></div>
  </>;
}

function Confirm({ id, data, setData, draft, flush, revision, refreshList }) {
  const { assignment, submission, turns } = data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const request = useRef(uid());
  const suggestions = similarTurns(draft.body, turns.filter(turn => turn.action !== 'restricted'), draft.items);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await flush();
      const result = await api(`/assignments/${id}/submission`, 'POST', { clientRequestId: request.current, revision: revision.current });
      setData(current => ({ ...current, submission: result.submission }));
      refreshList();
      go('a', id, 'history');
    } catch (failure) {
      setError({ text: failure.message, error: true });
      setBusy(false);
    }
  }
  const next = (submission?.versions.at(-1).no ?? 0) + 1;
  return <>
    <Crumbs items={[['내 과제', href('list')], [assignment.title, href('a', id)], ['제출 준비', href('a', id, 'prepare')], ['제출 확인']]} />
    <Intro title="제출 확인" subtitle={`${next}회차로 제출돼요. 마감 전까지 다시 제출할 수 있어요.`} context={assignment.courseName + ' · ' + assignment.title} />
    <div className="stack">
      <section className="card"><h2>{draft.title}</h2>
        <p className="muted small">문단 {paragraphRanges(draft.body).length} · {draft.body.trim().length.toLocaleString('ko-KR')}자</p>
        <details className="disclosure material"><summary>본문 미리 보기</summary><p className="plain-text">{draft.body.trim()}</p></details></section>
      <section className="card"><h2>교수자에게 함께 전달되는 내용</h2>
        <Details entries={[
          ['AI 활용 기록', draft.items.length ? draft.items.length + '개 · 연결한 대화 원문 포함' : 'AI를 사용하지 않았다고 확인함'],
          ['자동 유사 대화', suggestions.length ? suggestions.length + '건' + (draft.objections.length ? ' · 이의 ' + draft.objections.length + '건' : '') : '없음'],
          ['기준 확인 대화', turns.filter(turn => turn.matchType === 'explicit_restriction' || turn.matchType === 'possible_match').length + '건'],
          ['마감', when(assignment.deadlineAt)],
        ]} /></section>
      <Notice message={error} />
    </div>
    <div className="actions"><a className="button secondary" href={href('a', id, 'prepare')}>제출 준비로</a>
      <button type="button" className="button" disabled={busy} onClick={submit}>{busy ? '제출하는 중…' : next > 1 ? `${next}회차 다시 제출` : '제출하기'}</button></div>
  </>;
}

function History({ id, data }) {
  const { assignment, submission } = data;
  const [no, setNo] = useState(submission?.version.no ?? null);
  const [version, setVersion] = useState(submission?.version ?? null);
  useEffect(() => {
    if (!submission || no === version?.no) return;
    api(`/assignments/${id}/submission?no=${no}`).then(result => setVersion(result.submission.version));
  }, [id, no, submission, version]);
  if (!submission) return <><Crumbs items={[['내 과제', href('list')], [assignment.title, href('a', id)], ['제출 이력']]} /><Empty title="아직 제출하지 않았어요" /></>;
  return <>
    <Crumbs items={[['내 과제', href('list')], [assignment.title, href('a', id)], ['제출 이력']]} />
    <Intro title="제출 이력" context={assignment.courseName + ' · ' + assignment.title}
      subtitle={assignment.open ? '마감 전까지 작업실에서 고쳐 다시 제출할 수 있어요.' : '마감된 과제예요.'} />
    <div className="stack">
      <section className="card receipt"><div className="check" aria-hidden="true">✓</div>
        <h2>{submission.versions.at(-1).no}회차 제출 완료</h2>
        <p className="muted">최근 제출 {when(submission.versions.at(-1).createdAt)}</p>
        <label className="field material">회차 선택<select value={no} onChange={event => setNo(Number(event.target.value))}>
          {submission.versions.map(entry => <option key={entry.no} value={entry.no}>{entry.no}회차 · {when(entry.createdAt)}</option>)}</select></label>
      </section>
      {version && <section className="card"><h2>{version.title}</h2>
        <p className="plain-text material">{version.body}</p>
        <div className="material"><h3>AI 활용 기록 {version.items.length}개</h3>
          {version.noAi && <p className="muted">AI를 사용하지 않았다고 확인함</p>}
          <ul className="plain-list">{version.items.map(item => <li key={item.id}><StagePill stages={assignment.stages} stage={item.stage} /> {USAGES[item.usage]} · {item.explanation}</li>)}</ul></div>
      </section>}
    </div>
    <div className="actions end">{assignment.open && <a className="button" href={href('a', id)}>작업실에서 수정하기</a>}</div>
  </>;
}
