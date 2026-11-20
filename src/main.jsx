import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import { Login } from './shell.jsx';
import { StudentApp } from './student.jsx';
import { TeacherApp } from './teacher.jsx';
import './style.css';

function App() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api('/session').then(setSession).catch(failure => setError(failure.message)); }, []);
  if (error) return <main className="boot"><p role="alert">{error}</p></main>;
  if (!session) return <main className="boot"><p role="status">문연을 여는 중…</p></main>;
  if (!session.user) return <Login demo={session.demo} onLogin={setSession} />;
  const logout = () => { history.replaceState(null, '', location.pathname); setSession({ ...session, user: null }); };
  const Workspace = session.user.role === 'teacher' ? TeacherApp : StudentApp;
  return <Workspace key={session.user.id} session={session} onLogout={logout} />;
}

createRoot(document.getElementById('root')).render(<App />);
