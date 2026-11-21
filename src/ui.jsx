import { useEffect, useRef } from 'react';
import { ACTIVITIES, STAGES } from '../shared/text.js';

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
  panel: <path d="M4 5h16v14H4zM9 5v14" />,
  download: <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M4.9 19.1 7 17m10-10 2.1-2.1" /></>,
  flag: <path d="M5 21V4m0 0h11l-2 4 2 4H5" />,
  trash: <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" />,
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
export function Masthead({ user, home, onLogout, busy, model }) {
  return <header className="masthead"><div className="masthead-inner">
    <Brand to={home} />
    <div className="account">
      {model && <span className="model-badge" title="과제 AI 연결 상태">AI · {model}</span>}
      <span>{user.name} · {user.role === 'teacher' ? '교수자' : '학생'}</span>
      <button type="button" className="account-button" disabled={busy} onClick={onLogout}>로그아웃</button>
    </div>
  </div></header>;
}
export function Intro({ title, subtitle, context, children }) {
  return <header className="intro">
    {context && <p className="context">{context}</p>}
    <div className="intro-row"><h1 id="screen-title" tabIndex={-1}>{title}</h1>{children}</div>
    {subtitle && <p className="subtitle">{subtitle}</p>}
  </header>;
}
export function Crumbs({ items }) {
  return <nav className="crumbs" aria-label="현재 위치"><ol>
    {items.map(([label, to], index) => <li key={index}>{to && index < items.length - 1 ? <a href={to}>{label}</a> : <span aria-current="page">{label}</span>}</li>)}
  </ol></nav>;
}
export function Notice({ message, tone = '' }) {
  if (!message) return null;
  const text = typeof message === 'string' ? message : message.text;
  const error = typeof message === 'object' && message.error;
  return <p className={'notice' + (error ? ' error' : tone ? ' ' + tone : '')} role={error ? 'alert' : 'status'}>{text}</p>;
}
export function Details({ entries }) {
  return <dl className="details">{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
export function WorkbenchTop({ title, context, back, backLabel, children }) {
  return <header className="workbench-top">
    <div className="workbench-heading">
      {back && <a className="icon-button" href={back} aria-label={backLabel} title={backLabel}><Icon name="arrow" /></a>}
      <div><p className="context">{context}</p><h1 id="screen-title" tabIndex={-1}>{title}</h1></div>
    </div>
    <div className="workbench-actions">{children}</div>
  </header>;
}
export function PaneTabs({ items, active, onChange }) {
  return <nav className="pane-navigation" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }} aria-label="작업 화면 선택">
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
export function Tabs({ items, active, onChange, label }) {
  return <div className="tabs" role="tablist" aria-label={label}>
    {items.map(([key, text]) => <button key={key} type="button" role="tab" aria-selected={key === active} onClick={() => onChange(key)}>{text}</button>)}
  </div>;
}

export function StagePill({ stages, stage }) {
  return <span className={'stage-pill stage-' + stage}>{stages?.[stage] ?? stage}</span>;
}
export function StageLegend({ stages }) {
  return <ul className="stage-legend" aria-label="활용 단계 범례">
    {STAGES.map(stage => <li key={stage}><mark className={'stage-mark stage-' + stage}>{stages[stage]}</mark></li>)}
  </ul>;
}
export function RulesTable({ stages, rules, compact }) {
  return <div className="table-scroll"><table className={'rules-table' + (compact ? ' compact' : '')}>
    <thead><tr><th scope="col">도움 유형</th>{STAGES.map(stage => <th key={stage} scope="col">{stages[stage]}</th>)}</tr></thead>
    <tbody>{Object.entries(ACTIVITIES).map(([activity, label]) => <tr key={activity}><th scope="row">{label}</th>
      {STAGES.map(stage => <td key={stage}>{rules[stage]?.[activity] === 'restricted'
        ? <span className="rule restricted">제한</span> : <span className="rule allowed">허용</span>}</td>)}</tr>)}</tbody>
  </table></div>;
}

export function Dialog({ open, title, onClose, children, actions }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="dialog-title">
    <header className="dialog-head"><h2 id="dialog-title">{title}</h2>
      <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}>×</button></header>
    <div className="dialog-body">{children}</div>
    {actions && <footer className="dialog-actions">{actions}</footer>}
  </dialog>;
}

export function Empty({ title, children }) {
  return <section className="card empty"><h2>{title}</h2>{children && <p className="muted">{children}</p>}</section>;
}
