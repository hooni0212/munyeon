import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { fromLocalInput, go, href, readBase64, remaining, toLocalInput, useRoute, useScreenFocus, when } from './lib.js';
import { ACTIVITIES, STAGES, USAGES, segments } from '../shared/text.js';
import {
  Crumbs, Empty, Icon, Intro, Notice, Pane, PaneTabs, Pill, StageLegend, StagePill, Tabs, WorkbenchTop,
} from './ui.jsx';
import { Shell } from './shell.jsx';

const statusLabels = { unsubmitted: '미제출', submitted: '검토 대기', questions_ready: '질문 준비 완료', evaluated: '평가 완료' };
const statusTones = { unsubmitted: 'neutral', submitted: 'amber', questions_ready: '', evaluated: '' };
const assignmentStatus = { draft: ['공개 전', 'neutral'], published: ['공개 중', ''], closed: ['마감', 'neutral'] };
const matchLabels = { explicit_restriction: '제한된 요청', possible_match: '기준 확인 필요', unspecified: '기준 미지정' };
const criteria = [['reason', '선택의 근거'], ['transfer', '조건이 달라질 때의 판단']];

function useLoad(load, deps) {
  const [state, setState] = useState({ data: null, error: null });
  const reload = useCallback(() => load().then(data => setState({ data, error: null })).catch(error => setState(current => ({ ...current, error }))), deps);
  useEffect(() => { setState({ data: null, error: null }); reload(); }, [reload]);
  return [state.data, state.error, reload, data => setState({ data, error: null })];
}
function Loading({ error, children = '불러오는 중…' }) {
  return error ? <Notice message={{ text: error.message, error: true }} /> : <p className="muted" role="status">{children}</p>;
}

export function TeacherApp({ session, onLogout }) {
  const { parts, query } = useRoute();
  const [area, courseId, sub, sectionId, , assignmentId, mode, submissionId] = parts.map(part => /^\d+$/.test(part) ? Number(part) : part);
  let content;
  let workbench = false;
  if (area !== 'c') content = <Courses />;
  else if (sub === 'settings') content = <CourseSettings courseId={courseId} />;
  else if (sub === 's' && !assignmentId) content = <Section courseId={courseId} sectionId={sectionId} />;
  else if (sub === 's' && mode === 'edit') content = <AssignmentEditor courseId={courseId} sectionId={sectionId} assignmentId={assignmentId} />;
  else if (sub === 's' && mode === 'r') {
    workbench = true;
    content = <Review key={assignmentId} courseId={courseId} sectionId={sectionId} assignmentId={assignmentId} submissionId={submissionId} query={query} model={session.model} />;
  } else if (sub === 's') content = <Roster courseId={courseId} sectionId={sectionId} assignmentId={assignmentId} />;
  else content = <Courses />;
  return <Shell session={session} home={href()} onLogout={onLogout} workbench={workbench} wide>{content}</Shell>;
}

function Courses() {
  const [data, error] = useLoad(() => api('/courses'), []);
  const [message, setMessage] = useState(null);
  useScreenFocus('courses');
  async function create(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const course = await api('/courses', 'POST', { name: form.get('name'), sections: String(form.get('sections')).split(',').map(item => item.trim()).filter(Boolean) });
      go('c', course.id, 'settings');
    } catch (failure) {
      setMessage({ text: failure.message, error: true });
    }
  }
  if (!data) return <Loading error={error} />;
  return <>
    <Intro title="내 과목" subtitle="분반을 고르면 그 분반의 과제와 제출 현황을 볼 수 있어요." />
    <div className="course-grid">{data.items.map(course => <section key={course.id} className="card course-card">
      <div className="row"><h2>{course.name}</h2><a className="icon-button bordered" href={href('c', course.id, 'settings')}><Icon name="gear" small />과목 설정</a></div>
      {course.sections.length ? <ul className="section-list">{course.sections.map(section => <li key={section.id}>
        <a href={href('c', course.id, 's', section.id)}><strong>{section.name}</strong>
          <span className="muted small">학생 {section.students}명 · 과제 {section.assignments}개</span><Icon name="right" small /></a></li>)}</ul>
        : <p className="muted small">분반이 없어요. 과목 설정에서 추가하세요.</p>}
    </section>)}</div>
    {!data.items.length && <Empty title="아직 과목이 없어요">아래에서 첫 과목을 만들어 보세요.</Empty>}
    <details className="card disclosure material" onToggle={() => setMessage(null)}><summary>새 과목 만들기</summary>
      <form className="fields" onSubmit={create}>
        <label>과목명<input name="name" required maxLength={120} placeholder="예: 창의융합적디자인" /></label>
        <label>분반 <span className="hint">쉼표로 구분</span><input name="sections" defaultValue="01분반" maxLength={300} /></label>
        <Notice message={message} />
        <div className="actions end"><button className="button">과목 만들기</button></div>
      </form>
    </details>
  </>;
}

function CourseSettings({ courseId }) {
  const [course, error, , setCourse] = useLoad(() => api('/courses/' + courseId), [courseId]);
  const [message, setMessage] = useState(null);
  const [tab, setTab] = useState('members');
  useScreenFocus('settings' + courseId);
  async function call(path, method, data, done) {
    setMessage(null);
    try {
      setCourse(await api('/courses/' + courseId + path, method, data));
      done?.();
      return true;
    } catch (failure) {
      setMessage({ text: failure.message, error: true });
      return false;
    }
  }
  if (!course) return <Loading error={error} />;
  return <>
    <Crumbs items={[['내 과목', href()], [course.name, href()], ['과목 설정']]} />
    <Intro title="과목 설정" context={course.name} />
    <Tabs label="과목 설정 항목" active={tab} onChange={setTab} items={[['members', '분반·수강 명단'], ['ai', '과목 AI 설정'], ['materials', '강의자료'], ['info', '기본 정보']]} />
    <Notice message={message} />
    {tab === 'members' && <Members course={course} call={call} />}
    {tab === 'ai' && <CourseAi course={course} call={call} />}
    {tab === 'materials' && <Materials course={course} call={call} setMessage={setMessage} />}
    {tab === 'info' && <form className="card fields" onSubmit={event => { event.preventDefault(); call('', 'PATCH', { name: new FormData(event.currentTarget).get('name') }, () => setMessage({ text: '저장했어요.' })); }}>
      <label>과목명<input name="name" required maxLength={120} defaultValue={course.name} /></label>
      <div className="actions end"><button className="button">저장</button></div></form>}
  </>;
}

function Members({ course, call }) {
  return <div className="stack">
    <section className="card">
      <div className="row adapt"><h2>분반</h2>
        <form className="inline-form" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; call('/sections', 'POST', { name: new FormData(form).get('name') }, () => form.reset()); }}>
          <input name="name" required maxLength={40} placeholder="새 분반 이름" aria-label="새 분반 이름" /><button className="button compact secondary">추가</button></form></div>
      <ul className="tags material">{course.sections.map(section => <li key={section.id}><a className="pill" href={href('c', course.id, 's', section.id)}>{section.name}</a></li>)}</ul>
    </section>
    <section className="card">
      <h2>수강 명단 <span className="muted small">{course.members.length}명</span></h2>
      <form className="inline-form material" onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        call('/members', 'POST', { username: values.get('username'), sectionId: Number(values.get('sectionId')) }, () => form.reset());
      }}>
        <input name="username" required maxLength={60} placeholder="학생 아이디" aria-label="학생 아이디" />
        <select name="sectionId" aria-label="분반">{course.sections.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select>
        <button className="button compact">학생 추가</button>
      </form>
      <p className="hint">운영자가 발급한 학생 계정의 아이디로 추가해요.</p>
      {course.members.length ? <table className="data-table material"><thead><tr><th>이름</th><th>아이디</th><th>분반</th><th><span className="visually-hidden">관리</span></th></tr></thead>
        <tbody>{course.members.map(member => <tr key={member.studentId}><td>{member.name}</td><td><code>{member.username}</code></td>
          <td><select aria-label={member.name + ' 분반'} value={member.sectionId} onChange={event => call('/members/' + member.studentId, 'PATCH', { sectionId: Number(event.target.value) })}>
            {course.sections.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select></td>
          <td><button type="button" className="text-link" onClick={() => confirm(member.name + ' 학생을 수강 명단에서 뺄까요? 제출 기록은 보존돼요.') && call('/members/' + member.studentId, 'DELETE')}>빼기</button></td></tr>)}</tbody></table>
        : <p className="muted small material">아직 수강 학생이 없어요.</p>}
    </section>
  </div>;
}

function CourseAi({ course, call }) {
  const [values, setValues] = useState({ learningGoal: course.learningGoal, instructions: course.instructions, examples: course.examples });
  const [saved, setSaved] = useState(false);
  const setExample = (index, key, value) => setValues({ ...values, examples: values.examples.map((item, at) => at === index ? { ...item, [key]: value } : item) });
  return <form className="stack" onSubmit={event => { event.preventDefault(); setSaved(false); call('', 'PATCH', values, () => setSaved(true)); }}>
    <p className="notice">과목 AI 설정은 과제를 공개하거나 과제 설정을 저장할 때 그 과제에 고정돼요. 진행 중인 과제에 반영하려면 과제 설정을 다시 저장하세요.</p>
    <section className="card fields">
      <label>학습 목표<textarea rows={3} maxLength={2000} value={values.learningGoal} onChange={event => setValues({ ...values, learningGoal: event.target.value })} /></label>
      <label>과제 AI 응답 지침<textarea rows={4} maxLength={4000} value={values.instructions}
        placeholder="예: 정답을 대신 쓰지 말고 근거를 찾는 방법을 안내한다." onChange={event => setValues({ ...values, instructions: event.target.value })} /></label>
    </section>
    <section className="card stack">
      <div className="row"><h2>예시 질문과 모범 답변</h2>
        <button type="button" className="button compact secondary" onClick={() => setValues({ ...values, examples: [...values.examples, { question: '', answer: '' }] })}><Icon name="plus" small />추가</button></div>
      {values.examples.map((example, index) => <fieldset key={index} className="example-row">
        <legend>예시 {index + 1}</legend>
        <label>질문<input required maxLength={1000} value={example.question} onChange={event => setExample(index, 'question', event.target.value)} /></label>
        <label>모범 답변<textarea required rows={2} maxLength={3000} value={example.answer} onChange={event => setExample(index, 'answer', event.target.value)} /></label>
        <button type="button" className="text-link" onClick={() => setValues({ ...values, examples: values.examples.filter((_, at) => at !== index) })}>삭제</button>
      </fieldset>)}
      {!values.examples.length && <p className="muted small">과제 AI가 답하는 방식의 예시를 넣을 수 있어요.</p>}
    </section>
    {saved && <Notice message="저장했어요." />}
    <div className="actions end"><button className="button">과목 AI 설정 저장</button></div>
  </form>;
}

function Materials({ course, call, setMessage }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  async function upload(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const result = await api('/extract', 'POST', { fileName: file.name, data: await readBase64(file) });
      setEditing({ id: editing?.id ?? null, name: editing?.name || file.name.replace(/\.[^.]+$/, ''), body: result.text });
    } catch (failure) {
      setMessage({ text: failure.message, error: true });
    } finally {
      setBusy(false);
    }
  }
  function save(event) {
    event.preventDefault();
    call(editing.id ? '/materials/' + editing.id : '/materials', editing.id ? 'PUT' : 'POST', { name: editing.name, body: editing.body }, () => setEditing(null));
  }
  return <div className="stack">
    <p className="notice">과제 AI는 질문과 관련 있는 자료 문단을 골라 참고해요. 자료를 고치면 버전이 올라가고, 다음에 저장·공개하는 과제부터 반영돼요.</p>
    {editing ? <form className="card fields" onSubmit={save}>
      <label>자료 이름<input required maxLength={160} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
      <label className="icon-button bordered file-button"><Icon name="attach" small />{busy ? '변환 중…' : '파일에서 불러오기 (.txt .pdf .docx)'}<input type="file" accept=".txt,.pdf,.docx" onChange={upload} /></label>
      <label>본문<textarea required rows={10} maxLength={60000} value={editing.body} onChange={event => setEditing({ ...editing, body: event.target.value })} /></label>
      <div className="actions"><button type="button" className="button secondary" onClick={() => setEditing(null)}>취소</button><button className="button">저장</button></div>
    </form> : <div className="actions end"><button type="button" className="button" onClick={() => setEditing({ id: null, name: '', body: '' })}><Icon name="plus" small />자료 추가</button></div>}
    {course.materials.map(material => <section key={material.id} className="card">
      <div className="row"><h2>{material.name}</h2><span className="muted small">v{material.version} · {when(material.updatedAt)}</span></div>
      <p className="muted small clamp">{material.body}</p>
      <div className="tags material"><button type="button" className="text-link" onClick={() => setEditing({ id: material.id, name: material.name, body: material.body })}>수정</button>
        <button type="button" className="text-link" onClick={() => confirm('이 자료를 삭제할까요?') && call('/materials/' + material.id, 'DELETE')}>삭제</button></div>
    </section>)}
  </div>;
}

function Section({ courseId, sectionId }) {
  const [data, error] = useLoad(() => Promise.all([api('/courses/' + courseId), api(`/courses/${courseId}/assignments?sectionId=${sectionId}`)]), [courseId, sectionId]);
  const [message, setMessage] = useState(null);
  useScreenFocus('section' + sectionId);
  if (!data) return <Loading error={error} />;
  const [course, { items }] = data;
  const section = course.sections.find(item => item.id === sectionId);
  async function create() {
    try {
      const assignment = await api(`/courses/${courseId}/assignments`, 'POST', { title: '새 과제', sectionIds: [sectionId] });
      go('c', courseId, 's', sectionId, 'a', assignment.id, 'edit');
    } catch (failure) {
      setMessage({ text: failure.message, error: true });
    }
  }
  return <>
    <Crumbs items={[['내 과목', href()], [course.name, href()], [section?.name ?? '분반']]} />
    <Intro title={section?.name ?? '분반'} context={course.name} subtitle={`학생 ${course.members.filter(member => member.sectionId === sectionId).length}명 · 과제 ${items.length}개`}>
      <button type="button" className="button" onClick={create}><Icon name="plus" small />새 과제</button>
    </Intro>
    <Notice message={message} />
    {items.length ? <ul className="assignment-cards">{items.map(item => {
      const [label, tone] = assignmentStatus[item.status];
      return <li key={item.id} className="card">
        <a className="card-link" href={href('c', courseId, 's', sectionId, 'a', item.id)}>
          <span className="stack tight"><span className="tags"><Pill tone={tone}>{label}</Pill>{item.open && item.deadlineAt && <span className="muted small">{remaining(item.deadlineAt)}</span>}</span>
            <strong className="card-title">{item.title}</strong><span className="muted small">마감 {when(item.deadlineAt)}</span></span>
          <span className="count"><strong>{item.submitted}</strong> / {item.total}<small>제출</small></span>
        </a>
      </li>;
    })}</ul> : <Empty title="이 분반에 낸 과제가 없어요">‘새 과제’로 만들고, 설정을 마친 뒤 공개하세요.</Empty>}
  </>;
}

function StatusActions({ assignment, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function set(status) {
    if (status === 'closed' && !confirm('과제를 마감할까요? 학생은 더 이상 작성·제출할 수 없어요.')) return;
    setBusy(true);
    setError(null);
    try { onChange(await api(`/assignments/${assignment.id}/status`, 'POST', { status })); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <span className="tags">
    {assignment.status === 'draft' && <button type="button" className="button compact" disabled={busy} onClick={() => set('published')}>공개하기</button>}
    {assignment.status === 'published' && <button type="button" className="button compact secondary" disabled={busy} onClick={() => set('closed')}>마감하기</button>}
    {assignment.status === 'closed' && <button type="button" className="button compact secondary" disabled={busy} onClick={() => set('published')}>다시 공개</button>}
    {error && <span className="error-text" role="alert">{error}</span>}
  </span>;
}

function AssignmentEditor({ courseId, sectionId, assignmentId }) {
  const [assignment, error, , setAssignment] = useLoad(() => api('/assignments/' + assignmentId), [assignmentId]);
  const [values, setValues] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  useScreenFocus('edit' + assignmentId);
  useEffect(() => {
    if (assignment) setValues({ title: assignment.title, instructions: assignment.instructions, deadline: toLocalInput(assignment.deadlineAt),
      sectionIds: assignment.sectionIds, stages: assignment.stages, rules: assignment.rules, alternativeHelp: assignment.alternativeHelp, rubric: assignment.rubric });
  }, [assignment]);
  if (!assignment || !values) return <Loading error={error} />;
  const set = patch => setValues({ ...values, ...patch });
  const toggleRule = (stage, activity) => set({ rules: { ...values.rules, [stage]: { ...values.rules[stage],
    [activity]: values.rules[stage][activity] === 'restricted' ? 'allowed' : 'restricted' } } });
  async function save(event) {
    event?.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { deadline, ...rest } = values;
      const result = await api('/assignments/' + assignmentId, 'PATCH', { ...rest, deadlineAt: fromLocalInput(deadline), revision: assignment.revision });
      setAssignment(result);
      setMessage({ text: result.status === 'draft' ? '저장했어요. 준비가 되면 공개하세요.' : '저장했어요. 학생 화면에 새 기준이 공개됐어요.' });
      return true;
    } catch (failure) {
      setMessage({ text: failure.message, error: true });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const [label, tone] = assignmentStatus[assignment.status];
  const back = href('c', courseId, 's', sectionId, 'a', assignmentId);
  return <>
    <Crumbs items={[['내 과목', href()], [assignment.courseName, href()], [assignment.sections.find(item => item.id === sectionId)?.name ?? '분반', href('c', courseId, 's', sectionId)],
      [assignment.title, back], ['과제 설정']]} />
    <Intro title="과제 설정" context={assignment.courseName}><span className="tags"><Pill tone={tone}>{label}</Pill>
      <StatusActions assignment={assignment} onChange={setAssignment} /></span></Intro>
    {assignment.status !== 'draft' && <p className="notice warn">공개된 과제예요. 저장하면 새 기준이 바로 공개되고, 이미 나눈 대화와 제출물에는 당시 기준이 남아요.</p>}
    <form onSubmit={save}><div className="stack">
      <section className="card fields">
        <label>과제 제목<input required maxLength={160} value={values.title} onChange={event => set({ title: event.target.value })} /></label>
        <label>과제 안내<textarea rows={6} maxLength={6000} value={values.instructions} onChange={event => set({ instructions: event.target.value })} /></label>
        <label>제출 마감 <span className="hint">한국 시간 · 마감 전까지 재제출 가능</span>
          <input type="datetime-local" value={values.deadline} onChange={event => set({ deadline: event.target.value })} /></label>
        <fieldset><legend>대상 분반</legend><div className="tags">{assignment.sections.map(section => <label key={section.id} className="choice">
          <input type="checkbox" checked={values.sectionIds.includes(section.id)}
            onChange={event => set({ sectionIds: event.target.checked ? [...values.sectionIds, section.id] : values.sectionIds.filter(id => id !== section.id) })} />{section.name}</label>)}</div></fieldset>
      </section>
      <section className="card stack">
        <h2>AI 활용 기준</h2>
        <p className="muted small">단계별로 허용·제한할 도움을 정하세요. 칸을 누르면 바뀌어요. 활용 단계 이름은 학생 화면의 색상 표시에도 쓰여요.</p>
        <div className="stage-names">{STAGES.map(stage => <label key={stage}><span className={'stage-pill stage-' + stage}>단계 {stage.slice(1)}</span>
          <input required maxLength={20} value={values.stages[stage]} onChange={event => set({ stages: { ...values.stages, [stage]: event.target.value } })} /></label>)}</div>
        <div className="table-scroll"><table className="rules-table editable">
          <thead><tr><th scope="col">도움 유형</th>{STAGES.map(stage => <th key={stage} scope="col">{values.stages[stage]}</th>)}</tr></thead>
          <tbody>{Object.entries(ACTIVITIES).map(([activity, name]) => <tr key={activity}><th scope="row">{name}</th>
            {STAGES.map(stage => <td key={stage}><button type="button" className={'rule ' + values.rules[stage][activity]}
              aria-label={`${values.stages[stage]} · ${name}: ${values.rules[stage][activity] === 'restricted' ? '제한' : '허용'}`}
              onClick={() => toggleRule(stage, activity)}>{values.rules[stage][activity] === 'restricted' ? '제한' : '허용'}</button></td>)}</tr>)}</tbody>
        </table></div>
        <label className="field">제한된 요청에 대신 줄 도움<textarea rows={2} maxLength={1000} value={values.alternativeHelp}
          placeholder="예: 문단을 대신 쓰는 대신 핵심 주장과 근거를 정리하도록 질문할게요." onChange={event => set({ alternativeHelp: event.target.value })} /></label>
      </section>
      <section className="card fields"><label>구술평가 기준<textarea rows={3} maxLength={2000} value={values.rubric} onChange={event => set({ rubric: event.target.value })} /></label></section>
      <Notice message={message} />
    </div>
    <div className="actions"><a className="button secondary" href={back}>제출 현황으로</a><button className="button" disabled={busy}>{busy ? '저장 중…' : '저장'}</button></div></form>
  </>;
}

function Roster({ courseId, sectionId, assignmentId }) {
  const [data, error, , setData] = useLoad(() => Promise.all([api('/assignments/' + assignmentId), api(`/assignments/${assignmentId}/roster?sectionId=${sectionId}`)]), [assignmentId, sectionId]);
  const [filter, setFilter] = useState({ query: '', status: 'all' });
  useScreenFocus('roster' + assignmentId);
  if (!data) return <Loading error={error} />;
  const [assignment, roster] = data;
  const section = assignment.sections.find(item => item.id === sectionId);
  const counts = Object.fromEntries(Object.keys(statusLabels).map(key => [key, roster.items.filter(row => row.status === key).length]));
  const visible = roster.items.filter(row => row.name.includes(filter.query.trim()) && (filter.status === 'all' || row.status === filter.status));
  const [label, tone] = assignmentStatus[assignment.status];
  return <>
    <Crumbs items={[['내 과목', href()], [assignment.courseName, href()], [section?.name ?? '분반', href('c', courseId, 's', sectionId)], [assignment.title]]} />
    <Intro title={assignment.title} context={assignment.courseName + ' · ' + (section?.name ?? '')}
      subtitle={`마감 ${when(assignment.deadlineAt)}${roster.open && assignment.deadlineAt ? ' · ' + remaining(assignment.deadlineAt) + ' · 마감 전에는 학생이 다시 제출할 수 있어요' : ''}`}>
      <span className="tags"><Pill tone={tone}>{label}</Pill><a className="button compact secondary" href={href('c', courseId, 's', sectionId, 'a', assignmentId, 'edit')}><Icon name="gear" small />과제 설정</a>
        <StatusActions assignment={assignment} onChange={next => setData([next, roster])} /></span>
    </Intro>
    <ul className="summary-strip" aria-label="검토 진행 상황">
      {Object.entries(statusLabels).map(([key, text]) => <li key={key}><button type="button" aria-pressed={filter.status === key}
        onClick={() => setFilter({ ...filter, status: filter.status === key ? 'all' : key })}><strong>{counts[key]}</strong><span>{text}</span></button></li>)}
    </ul>
    <section className="card">
      <div className="filters"><label className="field">학생 검색<input type="search" value={filter.query} placeholder="이름으로 검색" onChange={event => setFilter({ ...filter, query: event.target.value })} /></label></div>
      {visible.length ? <ul className="roster">{visible.map(row => <li key={row.studentId}>
        <div><strong>{row.name}</strong>{row.submissionId && <p className="small muted">{row.versionNo}회차 · {when(row.submittedAt)}</p>}</div>
        <span className="tags"><Pill tone={statusTones[row.status]}>{statusLabels[row.status]}</Pill>
          {row.pendingEvents > 0 && <Pill tone="amber">기준 확인 {row.pendingEvents}</Pill>}</span>
        <div>{row.submissionId ? <a className="button compact secondary" href={href('c', courseId, 's', sectionId, 'a', assignmentId, 'r', row.submissionId)}>검토하기</a>
          : <span className="small muted">제출물 없음</span>}</div>
      </li>)}</ul> : <p className="muted material">{roster.items.length ? '조건에 맞는 학생이 없어요.' : '이 분반에 수강 학생이 없어요. 과목 설정에서 명단을 추가하세요.'}</p>}
    </section>
  </>;
}

// ── 검토 작업실 ─────────────────────────────────────────────
function Review({ courseId, sectionId, assignmentId, submissionId, query, model }) {
  const [roster, setRoster] = useState(null);
  const [detail, setDetail] = useState(null);
  const [failure, setFailure] = useState(null);
  const [pane, setPane] = useState('document');
  const [mode, setMode] = useState('marked');
  const [tab, setTab] = useState('evidence');
  const [selection, setSelection] = useState({ kind: 'paragraph', index: 0 });
  const [compose, setCompose] = useState(null);
  const no = query.get('no') ? Number(query.get('no')) : null;
  const base = ['c', courseId, 's', sectionId, 'a', assignmentId];

  const loadRoster = useCallback(() => api(`/assignments/${assignmentId}/roster?sectionId=${sectionId}`).then(result => setRoster(result.items)), [assignmentId, sectionId]);
  useEffect(() => { loadRoster().catch(setFailure); }, [loadRoster]);
  useEffect(() => {
    let current = true;
    setFailure(null);
    api(`/submissions/${submissionId}${no ? '?no=' + no : ''}`).then(result => {
      if (!current) return;
      setDetail(result);
      const first = result.version.items.find(item => item.start != null);
      setSelection(first ? { kind: 'item', id: first.id } : { kind: 'paragraph', index: 0 });
      setCompose(null);
    }).catch(error => { if (current) setFailure(error); });
    return () => { current = false; };
  }, [submissionId, no]);
  useScreenFocus('review' + submissionId);
  const update = useCallback(result => { setDetail(current => ({ ...result, version: current.version.no === result.version.no ? result.version : current.version })); loadRoster(); }, [loadRoster]);

  if (failure) return <div className="workbench-shell"><Notice message={{ text: failure.message, error: true }} /></div>;
  if (!detail || !roster) return <p className="muted" role="status">제출물을 불러오는 중…</p>;
  const { version, assignment } = detail;
  const latest = version.no === detail.latestNo;
  const pending = detail.policyEvents.filter(event => event.status === 'pending').length;
  const select = next => {
    setSelection(next);
    setTab('evidence');
    if (matchMedia('(max-width: 970px)').matches) setPane('inspector');
  };
  const startQuestion = anchor => {
    setCompose({ anchor, text: '' });
    setTab('questions');
    if (matchMedia('(max-width: 970px)').matches) setPane('inspector');
  };
  const submitted = roster.filter(row => row.submissionId);
  const index = submitted.findIndex(row => row.submissionId === submissionId);

  return <div className="workbench-shell">
    <WorkbenchTop title={detail.student.name + '의 제출물'} back={href(...base)} backLabel="제출 현황으로"
      context={`${detail.student.sectionName ?? ''} · ${assignment.title}${assignment.open ? ' · 마감 전(학생이 다시 제출할 수 있음)' : ''}`}>
      <label className="inline-field">제출 회차<select value={version.no} onChange={event => go(...base, 'r', submissionId + (Number(event.target.value) === detail.latestNo ? '' : '?no=' + event.target.value))}>
        {detail.versions.map(entry => <option key={entry.no} value={entry.no}>{entry.no}회차{entry.no === detail.latestNo ? ' (최신)' : ''} · {when(entry.createdAt)}</option>)}</select></label>
    </WorkbenchTop>
    {!latest && <p className="banner">이전 회차를 보고 있어요. 질문 작성과 확인 표시는 최신 회차에서 할 수 있어요.</p>}
    <PaneTabs items={[['roster', '학생'], ['document', '제출물'], ['inspector', '근거·질문']]} active={pane} onChange={setPane} />
    <div className="workbench-grid teacher-grid">
      <Pane id="roster" active={pane} className="rail" title="학생" icon="users" aside={<span className="meta">{submitted.length}/{roster.length} 제출</span>}>
        <div className="pane-scroll rail-content"><ul className="rail-roster">{roster.map(row => {
          const body = <><span className="initial" aria-hidden="true">{row.name[0]}</span><span><strong>{row.name}</strong>
            <small>{statusLabels[row.status]}{row.versionNo > 1 ? ` · ${row.versionNo}회차` : ''}{row.pendingEvents ? ' · 확인 ' + row.pendingEvents : ''}</small></span></>;
          return <li key={row.studentId}>{row.submissionId
            ? <a className="roster-person" href={href(...base, 'r', row.submissionId)} aria-current={row.submissionId === submissionId ? 'page' : undefined}
              onClick={() => setPane('document')}>{body}</a>
            : <div className="roster-person is-muted">{body}</div>}</li>;
        })}</ul></div>
      </Pane>
      <Pane id="document" active={pane} className="reader-pane" title="제출물" icon="file"
        aside={<div className="segmented" role="group" aria-label="보기 방식">
          <button type="button" aria-pressed={mode === 'plain'} onClick={() => setMode('plain')}>원본 보기</button>
          <button type="button" aria-pressed={mode === 'marked'} onClick={() => setMode('marked')}>AI 활용 표시</button></div>}>
        <Reader detail={detail} mode={mode} selection={selection} select={select} />
        <nav className="student-pagination" aria-label="제출 학생 이동">
          {[[submitted[index - 1], '이전 학생', 'arrow'], [submitted[index + 1], '다음 학생', 'right']].map(([row, label, icon]) => row
            ? <a key={label} className="icon-button" href={href(...base, 'r', row.submissionId)}><Icon name={icon} small />{label} · {row.name}</a>
            : <span key={label} className="icon-button" aria-disabled="true"><Icon name={icon} small />{label}</span>)}
        </nav>
      </Pane>
      <Pane id="inspector" active={pane} className="inspector-pane" title="검토" icon="link">
        <Tabs label="검토 항목" active={tab} onChange={setTab} items={[['evidence', 'AI 활용 근거'], ['policy', `기준 확인${pending ? ' ' + pending : ''}`],
          ['questions', `구술 질문 ${detail.questions.length}`]]} />
        <div className="pane-scroll inspect-content" aria-live="polite">
          {tab === 'evidence' && <Evidence detail={detail} selection={selection} select={select} update={update} startQuestion={startQuestion} latest={latest} />}
          {tab === 'policy' && <Policy detail={detail} update={update} />}
          {tab === 'questions' && <Questions key={detail.id + ':' + version.no} detail={detail} update={update} model={model} compose={compose} setCompose={setCompose} latest={latest}
            showAnchor={anchor => select(anchor.itemId ? { kind: 'item', id: anchor.itemId } : { kind: 'paragraph', index: anchor.paragraph ?? 0 })} />}
        </div>
      </Pane>
    </div>
  </div>;
}

function Reader({ detail, mode, selection, select }) {
  const { version, assignment } = detail;
  const anchored = version.items.filter(item => item.start != null);
  const outside = version.items.filter(item => item.start == null);
  const flagged = new Set(detail.flags.map(flag => flag.target));
  const selectedIds = selection.kind === 'item' ? new Set([selection.id]) : new Set();
  return <div className="pane-scroll paper-scroll">
    <article className="paper-sheet reader-paper">
      <h3 className="doc-title">{version.title}</h3>
      <p className="reader-meta">{detail.student.name} · {version.no}회차 · {when(version.createdAt)} · 문단 {version.paragraphs.length}</p>
      {version.file && <p className="file-note"><Icon name="attach" small />{version.file.name}
        <a className="text-link" href={'/api/v1/files/' + version.file.id} download><Icon name="download" small />원본 파일 받기</a>
        {version.editedAfterUpload && <Pill tone="amber">업로드 후 수정됨</Pill>}</p>}
      {mode === 'marked' && anchored.length > 0 && <StageLegend stages={assignment.stages} />}
      <ol className="reader-list">{version.paragraphs.map(paragraph => {
        const local = anchored.filter(item => item.start < paragraph.end && item.end > paragraph.start)
          .map(item => ({ ...item, start: Math.max(item.start, paragraph.start) - paragraph.start, end: Math.min(item.end, paragraph.end) - paragraph.start }));
        const system = version.systemLinks.filter(link => link.paragraph === paragraph.index);
        const questions = detail.questions.filter(question => question.anchor.paragraph === paragraph.index);
        const active = selection.kind === 'paragraph' && selection.index === paragraph.index;
        return <li key={paragraph.index} className={'reader-paragraph' + (active ? ' is-active' : '')}>
          <button type="button" className="paragraph-meta" aria-pressed={active} onClick={() => select({ kind: 'paragraph', index: paragraph.index })}>
            문단 {paragraph.index + 1}
            {mode === 'marked' && local.length > 0 && <Pill>학생 기록 {local.length}</Pill>}
            {mode === 'marked' && system.length > 0 && <Pill tone="amber">유사 대화 {system.length}</Pill>}
            {flagged.has('p:' + paragraph.index) && <Pill tone="amber"><Icon name="flag" small />확인 필요</Pill>}
            {questions.length > 0 && <Pill tone="neutral">질문 {questions.length}</Pill>}
          </button>
          <p className="paragraph-text">{mode === 'plain' ? paragraph.text : segments(paragraph.text, local).map(part => {
            if (!part.items.length) return <span key={part.start}>{part.text}</span>;
            const item = part.items.at(-1);
            return <button key={part.start} type="button" className={'stage-mark stage-' + item.stage + (part.items.some(entry => selectedIds.has(entry.id)) ? ' is-selected' : '')}
              title={`${assignment.stages[item.stage]} · ${USAGES[item.usage]}`} onClick={() => select({ kind: 'item', id: item.id })}>{part.text}</button>;
          })}</p>
        </li>;
      })}</ol>
      {mode === 'marked' && (outside.length > 0 || version.noAi) && <section className="outside-items">
        <h4>문서에 반영하지 않은 활용 기록</h4>
        {version.noAi && <p className="muted small">학생이 AI를 사용하지 않았다고 확인했어요.</p>}
        <ul>{outside.map(item => <li key={item.id}><button type="button" className={'outside-item' + (selectedIds.has(item.id) ? ' is-selected' : '')} onClick={() => select({ kind: 'item', id: item.id })}>
          <StagePill stages={assignment.stages} stage={item.stage} />{USAGES[item.usage]} · {item.explanation.slice(0, 60)}</button></li>)}</ul>
      </section>}
    </article>
  </div>;
}

function FlagToggle({ detail, target, update, disabled }) {
  const flag = detail.flags.find(entry => entry.target === target);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try { update(await api(`/submissions/${detail.id}/flags`, 'PUT', { target, flagged: !flag, memo: '' })); } finally { setBusy(false); }
  }
  return <button type="button" className={'icon-button' + (flag ? ' is-on' : '')} aria-pressed={Boolean(flag)} disabled={busy || disabled} onClick={toggle}>
    <Icon name="flag" small />{flag ? '확인 필요 표시됨' : '확인 필요 표시'}</button>;
}

function ItemEvidence({ item, detail, update, startQuestion, latest }) {
  const { stages } = detail.assignment;
  return <section className={'inspect-block stage-edge-' + item.stage}>
    <div className="row"><h3><StagePill stages={stages} stage={item.stage} /> {USAGES[item.usage]}</h3><Pill>학생 기록</Pill></div>
    {item.quote ? <blockquote className="item-quote">{item.quote}</blockquote> : <p className="muted small">문서에 반영하지 않은 기록이에요.</p>}
    <div className="inspect-block tint"><h4>학생 설명</h4><p className="plain-text">{item.explanation}</p></div>
    {item.turns.length ? <ul className="turn-excerpts">{item.turns.map((turn, index) => <li key={turn.id ?? index}>
      <p className="turn-label">{turn.legacy ? '이전 방식 공유 기록' : <><StagePill stages={stages} stage={turn.stage} /> {ACTIVITIES[turn.activity]}</>}</p>
      {turn.prompt && <p><strong>학생</strong> {turn.prompt}</p>}<p><strong>AI</strong> {turn.reply}</p></li>)}</ul>
      : <p className="muted small">문연 대화 연결 없음 · 외부 AI 도구나 직접 기록이에요.</p>}
    <div className="inspect-actions"><FlagToggle detail={detail} target={'item:' + item.id} update={update} disabled={!latest} />
      <button type="button" className="button compact secondary" disabled={!latest} onClick={() => startQuestion({ itemId: item.id })}>이 기록으로 질문 작성</button></div>
  </section>;
}

function Evidence({ detail, selection, select, update, startQuestion, latest }) {
  const { version } = detail;
  if (selection.kind === 'item') {
    const item = version.items.find(entry => entry.id === selection.id);
    if (!item) return <p className="muted">항목을 선택하세요.</p>;
    return <>
      {item.paragraph != null && <button type="button" className="text-link" onClick={() => select({ kind: 'paragraph', index: item.paragraph })}>문단 {item.paragraph + 1} 전체 보기</button>}
      <ItemEvidence item={item} detail={detail} update={update} startQuestion={startQuestion} latest={latest} />
    </>;
  }
  const paragraph = version.paragraphs[selection.index];
  if (!paragraph) return <p className="muted">문단을 선택하세요.</p>;
  const items = version.items.filter(item => item.start != null && item.start < paragraph.end && item.end > paragraph.start);
  const system = version.systemLinks.filter(link => link.paragraph === paragraph.index);
  return <>
    <section className="inspect-block"><div className="row"><h3>문단 {paragraph.index + 1}</h3>
      <FlagToggle detail={detail} target={'p:' + paragraph.index} update={update} disabled={!latest} /></div>
      <p className="excerpt">{paragraph.text}</p>
      <div className="inspect-actions"><button type="button" className="button compact secondary" disabled={!latest}
        onClick={() => startQuestion({ start: paragraph.start, end: paragraph.end, paragraph: paragraph.index })}>이 문단으로 질문 작성</button></div></section>
    {items.length ? items.map(item => <ItemEvidence key={item.id} item={item} detail={detail} update={update} startQuestion={startQuestion} latest={latest} />)
      : <section className="inspect-block"><h3>학생 기록</h3><p className="muted small">이 문단에 학생이 연결한 AI 활용 기록이 없어요.</p></section>}
    <section className="inspect-block"><div className="row"><h3>자동 분석</h3><Pill tone="neutral">시스템</Pill></div>
      {system.length ? system.map(link => <div key={link.key} className="system-link">
        <p className="small"><strong>AI 대화와 유사</strong> · 겹침 {Math.round(link.score * 100)}%</p>
        <p className="small"><strong>학생</strong> {link.prompt}</p><p className="small"><strong>AI</strong> {link.reply}</p>
        {link.objection && <p className="notice small">학생 이의: {link.objection}</p>}
      </div>) : <p className="muted small">관련 기록 미확인 · 이 문단과 겹치는 과제 대화를 찾지 못했어요.</p>}
      <p className="hint">표현이 겹치는지만 본 결과예요. AI 사용 여부나 작성 주체를 판단하지 않아요.</p>
    </section>
  </>;
}

function Policy({ detail, update }) {
  const [busy, setBusy] = useState(null);
  if (!detail.policyEvents.length) return <p className="muted">이 학생의 과제 대화에서 기준 확인 항목이 없어요.</p>;
  async function set(event, status) {
    setBusy(event.id);
    try { update(await api(`/submissions/${detail.id}/policy-events/${event.id}`, 'PATCH', { status, memo: event.memo })); } finally { setBusy(null); }
  }
  return <>
    <p className="hint">학생이 제한된 도움을 골랐거나, 제한 기준과 관련될 수 있는 요청이에요. 자동 감점에 쓰지 않아요.</p>
    {detail.policyEvents.map(event => <section key={event.id} className="inspect-block">
      <div className="row"><h3>{matchLabels[event.matchType]}</h3><Pill tone={event.status === 'pending' ? 'amber' : 'neutral'}>
        {{ pending: '확인 필요', confirmed: '교수자 확인', dismissed: '확인 후 해제' }[event.status]}</Pill></div>
      <p className="small muted"><StagePill stages={detail.assignment.stages} stage={event.stage} /> {ACTIVITIES[event.activity]} · 당시 기준: {event.rule === 'restricted' ? '제한' : event.rule === 'allowed' ? '허용' : '미지정'} · {when(event.createdAt)}</p>
      <dl><div><dt>학생 요청</dt><dd>{event.prompt}</dd></div><div><dt>시스템 답변</dt><dd>{event.reply}</dd></div></dl>
      <div className="inspect-actions">
        <button type="button" className="button compact" disabled={busy === event.id} onClick={() => set(event, 'confirmed')}>확인함</button>
        <button type="button" className="button compact secondary" disabled={busy === event.id} onClick={() => set(event, 'dismissed')}>해제</button>
        {event.status !== 'pending' && <button type="button" className="text-link" onClick={() => set(event, 'pending')}>되돌리기</button>}
      </div>
    </section>)}
  </>;
}

function anchorLabel(anchor) {
  if (!anchor?.quote) return '근거 없음';
  return (anchor.paragraph != null ? `문단 ${anchor.paragraph + 1} · ` : '') + anchor.quote.slice(0, 50) + (anchor.quote.length > 50 ? '…' : '');
}

function Questions({ detail, update, model, compose, setCompose, latest, showAnchor }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [editing, setEditing] = useState(null);
  const anchorOf = useMemo(() => {
    if (!compose?.anchor) return null;
    if (compose.anchor.itemId) {
      const item = detail.version.items.find(entry => entry.id === compose.anchor.itemId);
      return { ...compose.anchor, quote: item?.quote || item?.explanation || '', paragraph: item?.paragraph };
    }
    return { ...compose.anchor, quote: detail.version.body.slice(compose.anchor.start, compose.anchor.end) };
  }, [compose, detail]);
  async function run(work, done) {
    setBusy(true);
    setMessage(null);
    try { update(await work()); done?.(); } catch (failure) { setMessage({ text: failure.message, error: true }); } finally { setBusy(false); }
  }
  const path = `/submissions/${detail.id}/questions`;
  return <>
    <div className="inspect-actions">
      <button type="button" className="button compact secondary" disabled={!latest} onClick={() => setCompose({ anchor: null, text: '' })}><Icon name="plus" small />직접 질문 추가</button>
      {model && <button type="button" className="button compact secondary" disabled={busy || !latest} onClick={() => run(() => api(path + '/suggest', 'POST'), () => setMessage({ text: '추천 질문을 받았어요. 사용할 질문을 선택하세요.' }))}>
        <Icon name="star" small />{busy ? '추천 받는 중…' : 'AI 질문 추천'}</button>}
    </div>
    <Notice message={message} />
    {compose && <form className="inspect-block tint" onSubmit={event => { event.preventDefault(); run(() => api(path, 'POST', { text: compose.text, anchor: compose.anchor }), () => setCompose(null)); }}>
      <h3>새 질문</h3>
      <p className="small muted">근거: {anchorOf ? anchorLabel(anchorOf) : '선택 안 함 (근거 탭에서 문단이나 기록을 고르면 연결돼요)'}</p>
      <textarea rows={3} required maxLength={1200} value={compose.text} autoFocus placeholder="예: 왜 이 기준을 선택했고, 어떤 경우에는 다른 기준이 더 적절할까요?"
        onChange={event => setCompose({ ...compose, text: event.target.value })} />
      <div className="inspect-actions"><button className="button compact" disabled={busy}>질문 저장</button>
        <button type="button" className="button compact secondary" onClick={() => setCompose(null)}>취소</button></div>
    </form>}
    {detail.questions.length ? <ol className="question-list">{detail.questions.map(question => <li key={question.id} className={'inspect-block' + (question.selected ? ' is-chosen' : '')}>
      <div className="row"><label className="choice"><input type="checkbox" checked={question.selected} disabled={busy}
        onChange={event => run(() => api(`${path}/${question.id}`, 'PATCH', { selected: event.target.checked }))} />구술에 사용</label>
        <span className="tags">{question.source === 'ai_suggested' ? <Pill tone="neutral">AI 추천{question.text !== question.originalText ? ' · 수정됨' : ''}</Pill> : <Pill tone="neutral">직접 작성</Pill>}
          {question.versionNo !== detail.latestNo && <Pill tone="amber">{question.versionNo}회차 기준</Pill>}</span></div>
      {editing?.id === question.id ? <form onSubmit={event => { event.preventDefault(); run(() => api(`${path}/${question.id}`, 'PATCH', { text: editing.text }), () => setEditing(null)); }}>
        <textarea rows={3} required maxLength={1200} value={editing.text} onChange={event => setEditing({ ...editing, text: event.target.value })} />
        <div className="inspect-actions"><button className="button compact" disabled={busy}>저장</button><button type="button" className="button compact secondary" onClick={() => setEditing(null)}>취소</button></div>
      </form> : <p className="oral-question">{question.text}</p>}
      <div className="inspect-actions">
        {question.anchor.quote && <button type="button" className="text-link" onClick={() => showAnchor(question.anchor)}>근거: {anchorLabel(question.anchor)}</button>}
        {editing?.id !== question.id && <button type="button" className="text-link" onClick={() => setEditing({ id: question.id, text: question.text })}>수정</button>}
        <button type="button" className="text-link" onClick={() => confirm('이 질문을 삭제할까요?') && run(() => api(`${path}/${question.id}`, 'DELETE'))}>삭제</button>
      </div>
    </li>)}</ol> : !compose && <p className="muted small">아직 질문이 없어요. 근거 탭에서 문단이나 학생 기록을 고른 뒤 질문을 작성해 보세요.</p>}
    <Score key={detail.id} detail={detail} update={update} />
  </>;
}

function Score({ detail, update }) {
  const saved = detail.evaluation;
  const [scores, setScores] = useState({ reason: saved?.reason ?? null, transfer: saved?.transfer ?? null });
  const [memo, setMemo] = useState(saved?.memo ?? '');
  const [message, setMessage] = useState(null);
  const total = scores.reason != null && scores.transfer != null ? scores.reason + scores.transfer : null;
  async function save(event) {
    event.preventDefault();
    try {
      update(await api(`/submissions/${detail.id}/evaluation`, 'PUT', { ...scores, memo }));
      setMessage({ text: '평가를 저장했어요.' });
    } catch (failure) {
      setMessage({ text: failure.message, error: true });
    }
  }
  return <details className="inspect-block score-block" open={saved?.reason != null}>
    <summary>구술평가 기록 {total != null && <span className="muted">· {total} / 4점</span>}</summary>
    <form className="fields" onSubmit={save}>
      {detail.assignment.rubric && <p className="hint">{detail.assignment.rubric}</p>}
      {criteria.map(([key, label]) => <fieldset key={key}><legend>{label}</legend><div className="scores">
        {[0, 1, 2].map(value => <label key={value}><input type="radio" name={key} checked={scores[key] === value}
          onChange={() => setScores({ ...scores, [key]: value })} />{value}점</label>)}</div></fieldset>)}
      <label>평가 메모<textarea rows={3} maxLength={3000} value={memo} onChange={event => setMemo(event.target.value)} /></label>
      <Notice message={message} />
      <div className="inspect-actions"><button className="button compact">평가 저장</button></div>
    </form>
  </details>;
}

