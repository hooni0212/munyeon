import { createWriteStream } from 'node:fs';
import { mkdir, link, mkdtemp, rm, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { openStore } from './store.js';

process.umask(0o077);
const database = resolve(process.env.MUNYEON_DB || 'data/munyeon.sqlite');
const [command, username, role, name] = process.argv.slice(2);

async function getPassword() {
  if (process.stdin.isTTY) throw new Error('비밀번호는 표준 입력으로 전달하세요. README의 예시를 참고하세요.');
  const parts = [];
  let size = 0;
  for await (const part of process.stdin) {
    parts.push(part);
    size += part.length;
    if (size > 520) throw new Error('비밀번호가 너무 길어요.');
  }
  const value = Buffer.concat(parts).toString('utf8').replace(/\r?\n$/, '');
  if (value.trim() !== value || value.length < 16 || value.length > 128 || /[\r\n\0]/.test(value)) {
    throw new Error('비밀번호는 앞뒤 공백과 줄바꿈 없이 16~128자로 지정하세요.');
  }
  return value;
}

async function main() {
  if (command === 'restore' && !username) {
    if (process.stdin.isTTY) throw new Error('백업 파일을 표준 입력으로 전달하세요.');
    await mkdir(dirname(database), { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(resolve(dirname(database), '.munyeon-restore-'));
    const snapshot = resolve(temporary, 'snapshot.sqlite');
    try {
      await pipeline(process.stdin, createWriteStream(snapshot, { mode: 0o600 }));
      const store = openStore(snapshot, { demo: false });
      try {
        if (store.get('PRAGMA integrity_check')?.integrity_check !== 'ok' ||
            store.all('PRAGMA foreign_key_check').length || !store.get("SELECT 1 FROM users WHERE role='teacher'")) {
          throw new Error('복구할 문연 데이터베이스를 확인해 주세요.');
        }
        store.run('DELETE FROM sessions');
        store.run('DELETE FROM rate_limits');
        store.get('PRAGMA wal_checkpoint(TRUNCATE)');
      } finally { store.db.close(); }
      await link(snapshot, database);
    } finally { await rm(temporary, { recursive: true, force: true }); }
    console.log('새 데이터베이스에 복구했어요.');
    return;
  }
  if (command === 'revoke-sessions' && !username) {
    const store = openStore(database, { demo: false });
    try { store.run('DELETE FROM sessions'); } finally { store.db.close(); }
    console.log('기존 세션을 만료했어요.');
    return;
  }
  if (command === 'backup' && username && !role) {
    const destination = resolve(username);
    const parent = dirname(destination);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(resolve(parent, '.munyeon-backup-'));
    const snapshot = resolve(temporary, 'snapshot.sqlite');
    try {
      const source = new DatabaseSync(database, { readOnly: true });
      try { await backup(source, snapshot); } finally { source.close(); }
      await chmod(snapshot, 0o600);
      await link(snapshot, destination);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    console.log('백업 저장 · ' + destination);
    return;
  }
  if (!['create-user', 'reset-password'].includes(command) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,59}$/.test(username || '') ||
      (command === 'create-user' && (!['teacher', 'student'].includes(role) || !name?.trim() || name.length > 80)) ||
      (command === 'reset-password' && role)) {
    throw new Error('사용법: create-user <아이디> <teacher|student> <이름> / reset-password <아이디> / backup <파일> / restore / revoke-sessions');
  }
  const password = await getPassword();
  await mkdir(dirname(database), { recursive: true, mode: 0o700 });
  // Password rotation must also work against an existing development database.
  const store = openStore(database, { demo: false, allowDemoAccounts: command === 'reset-password' });
  try {
    if (command === 'reset-password') {
      if (!store.resetPassword(username, password)) throw new Error('계정을 찾을 수 없어요.');
    } else {
      if (store.get('SELECT id FROM users WHERE username=?', username)) throw new Error('이미 사용하는 아이디예요.');
      store.createAccount({ username, name: name.trim(), role, password });
    }
    console.log('계정 저장 · ' + username);
  } finally {
    store.db.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
