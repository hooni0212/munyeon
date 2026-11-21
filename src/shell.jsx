import { useState } from 'react';
import { api } from './api.js';
import { Brand, Masthead, Notice } from './ui.jsx';

export function Shell({ session, home, onLogout, workbench, wide, children }) {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try { await api('/logout', 'POST'); } finally { onLogout(); }
  }
  return <>
    <button type="button" className="skip" onClick={() => document.getElementById('workspace').focus()}>본문으로 건너뛰기</button>
    <Masthead user={session.user} model={session.model} home={home} onLogout={logout} busy={busy} />
    <main id="workspace" tabIndex={-1} className={workbench ? 'workbench' : wide ? 'wide' : ''}>{children}</main>
  </>;
}

export function Login({ demo, onLogin }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [values, setValues] = useState({ username: '', password: '' });
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api('/login', 'POST', values));
    } catch (failure) {
      setError({ text: failure.message, error: true });
      setBusy(false);
    }
  }
  const accounts = [['교수자 · 창의융합적디자인', 'teacher'], ['교수자 · 디자인 리서치 방법', 'teacher2'],
    ['학생 · 김하윤 (두 과목 수강)', 'student'], ['학생 · 박서준', 'student2'], ['학생 · 이유진 (미제출)', 'student3']];
  return <div className="login-page">
    <header className="masthead"><div className="masthead-inner"><Brand to="#/" /></div></header>
    <main id="workspace" className="login-main">
      <section className="card login-card">
        <h1 id="screen-title" tabIndex={-1}>로그인</h1>
        <p className="subtitle">AI 활용 과정을 설명하고, 구술로 확인하는 과제 작업실</p>
        <form className="fields" onSubmit={submit}>
          <label>아이디<input name="username" autoComplete="username" required maxLength={60} value={values.username}
            onChange={event => setValues({ ...values, username: event.target.value })} /></label>
          <label>비밀번호<input name="password" type="password" autoComplete="current-password" required maxLength={128}
            value={values.password} onChange={event => setValues({ ...values, password: event.target.value })} /></label>
          <Notice message={error} />
          <button className="button" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
        </form>
        <p className="hint login-help">계정은 담당 교수자나 운영자가 발급해요.</p>
        {demo && <details className="disclosure material"><summary>로컬 체험 계정</summary>
          <ul className="demo-accounts">{accounts.map(([label, username]) => <li key={username}>
            <span><strong>{label}</strong> <code>{username}</code></span>
            <button type="button" className="text-link" onClick={() => setValues({ username, password: 'munyeon-' + username })}>채우기</button>
          </li>)}</ul>
        </details>}
      </section>
    </main>
  </div>;
}
