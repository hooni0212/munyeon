import { href } from './lib.js';

const glyphs = {
  arrow: <path d="m13 6-6 6 6 6M7 12h12" />,
  right: <path d="m9 6 6 6-6 6" />,
  file: <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm6 0v5h5M8 12h7M8 16h7" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  chat: <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 5h8M8 13h5" />,
  check: <path d="m5 12 4 4L19 6" />,
  link: <path d="m10 13 4-4m-7 8-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m4 4a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-1 1" />,
  send: <path d="M12 19V5m-6 6 6-6 6 6" />,
  attach: <path d="M5 16.5 15 6.5a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9m-5 12 8-8" />,
  users: <><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2m2-16a3 3 0 0 1 0 6m4 10v-2a4 4 0 0 0-4-4" /></>,
  star: <path d="M12 2 9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2Z" />,
  alert: <path d="M12 8v5m0 3h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
};

export function Icon({ name, small = false }) {
  return <svg className={'icon' + (small ? ' small-icon' : '')} viewBox="0 0 24 24" aria-hidden="true">{glyphs[name]}</svg>;
}

export function Pill({ children, tone = '' }) {
  return <span className={'pill' + (tone ? ' ' + tone : '')}>{children}</span>;
}

export function Brand({ to }) {
  return <a className="brand" href={to}><span className="mark" aria-hidden="true">文</span>
    <span><strong>문연</strong><small>과제 작업실</small></span></a>;
}

export function Masthead({ user, home, onLogout, busy }) {
  return <header className="masthead"><div className="masthead-inner">
    <Brand to={home} />
    <div className="account">
      <span>{user.name} · {user.role === 'teacher' ? '교수자' : '학생'}</span>
      <button type="button" className="account-button" disabled={busy} onClick={onLogout}>로그아웃</button>
    </div>
  </div></header>;
}

export function Navigation({ items }) {
  return <nav className="navigation" aria-label="주 메뉴"><div className="navigation-inner">
    {items.map(([to, label, current]) => <a key={to} href={to} aria-current={current ? 'page' : undefined}>{label}</a>)}
  </div></nav>;
}

export function Intro({ title, subtitle, context }) {
  return <header className="intro">
    {context && <p className="context">{context}</p>}
    <h1 id="screen-title" tabIndex={-1}>{title}</h1>
    {subtitle && <p className="subtitle">{subtitle}</p>}
  </header>;
}

export function Trail({ to, children }) {
  return <a className="trail" href={to}>← {children}</a>;
}

export function Notice({ message, tone = '' }) {
  if (!message) return null;
  const text = typeof message === 'string' ? message : message.text;
  const error = typeof message === 'object' && message.error;
  return <p className={'notice' + (error ? ' error' : tone ? ' ' + tone : '')} role={error ? 'alert' : 'status'}>{text}</p>;
}

export function Rules({ assignment }) {
  return <ul className="rule-list">
    <li><Pill>허용</Pill><span>{assignment.allowed || '지정된 활용 없음'}</span></li>
    <li><Pill tone="amber">제한</Pill><span>{assignment.restricted || '별도 제한 없음'}</span></li>
  </ul>;
}

export function Steps({ current }) {
  return <ol className="steps" aria-label="과제 제출 단계">
    {['과제 작성', 'AI 활용 확인', '제출 확인'].map((label, index) =>
      <li key={label} aria-current={index + 1 === current ? 'step' : undefined}><b aria-hidden="true">{index + 1}</b>{label}</li>)}
  </ol>;
}

export function Details({ entries }) {
  return <dl className="details">{entries.map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function WorkbenchTop({ title, context, back, backLabel, children }) {
  return <header className="workbench-top">
    <div className="workbench-heading">
      <a className="icon-button" href={back} aria-label={backLabel} title={backLabel}><Icon name="arrow" /></a>
      <div><p className="context">{context}</p><h1 id="screen-title" tabIndex={-1}>{title}</h1></div>
    </div>
    <div className="workbench-actions">{children}</div>
  </header>;
}

export function PaneTabs({ items, active, onChange }) {
  return <nav className="pane-navigation" aria-label="작업 화면 선택">
    {items.map(([key, label]) => <button key={key} type="button" aria-controls={'pane-' + key}
      aria-pressed={key === active} onClick={() => onChange(key)}>{label}</button>)}
  </nav>;
}

export function Pane({ id, active, className, title, icon, aside, children }) {
  return <section className={'pane ' + className} id={'pane-' + id} data-pane-active={id === active} aria-labelledby={'label-' + id}>
    <header className="pane-head"><h2 id={'label-' + id}><Icon name={icon} />{title}</h2>{aside}</header>
    {children}
  </section>;
}

export function LinkButton({ to, id, children, secondary, compact }) {
  return <a className={'button' + (secondary ? ' secondary' : '') + (compact ? ' compact' : '')} href={href(to, id)}>{children}</a>;
}

export function ReportSummary({ report }) {
  if (report.mode === 'none') return <p>AI를 사용하지 않았다고 확인함</p>;
  if (report.mode === 'manual') return <p className="plain-text">{report.explanation}</p>;
  if (report.mode === 'unreported') return <p className="muted">AI 활용 보고 없음 (이전 방식 제출)</p>;
  return <>
    <p>문단 {report.paragraph + 1}에 연결한 대화 1건</p>
    <Details entries={[
      ...(report.question ? [['학생 질문', report.question]] : []),
      ['AI 답변', report.excerpt],
      ['활용 설명', report.explanation],
    ]} />
  </>;
}
