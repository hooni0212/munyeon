import { useEffect, useState } from 'react';

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const timeFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function when(value) {
  return value ? dateFormat.format(new Date(value)) : '미정';
}
export function clock(value) {
  return value ? timeFormat.format(new Date(value)) : '';
}
// datetime-local 입력(한국 시간)과 UTC ISO 문자열을 오간다.
export function toLocalInput(iso) {
  if (!iso) return '';
  const date = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return date.toISOString().slice(0, 16);
}
export function fromLocalInput(value) {
  return value ? new Date(value + ':00+09:00').toISOString() : null;
}
export function remaining(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return '마감됨';
  const hours = Math.floor(ms / 3600_000);
  return hours >= 48 ? Math.floor(hours / 24) + '일 남음' : hours >= 1 ? hours + '시간 남음' : '1시간 이내';
}
export const uid = () => (crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 36);

// 주소는 #/조각/조각 형식. 숫자 조각은 ID로 쓴다.
export function parseRoute(hash = location.hash) {
  const [path = '', search = ''] = hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(search) };
}
export function href(...parts) {
  return '#/' + parts.filter(part => part != null && part !== '').join('/');
}
export function go(...parts) {
  const next = href(...parts);
  if (location.hash !== next) location.hash = next;
}
export function replace(...parts) {
  history.replaceState(null, '', href(...parts));
  dispatchEvent(new HashChangeEvent('hashchange'));
}
export function useRoute() {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const update = () => setRoute(parseRoute());
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  return route;
}

// 화면이 바뀌면 제목으로 포커스를 옮겨 스크린리더가 새 화면을 읽게 한다.
export function useScreenFocus(key) {
  useEffect(() => {
    scrollTo(0, 0);
    document.getElementById('screen-title')?.focus({ preventScroll: true });
  }, [key]);
}

export function stored(key, fallback) {
  try {
    const value = localStorage.getItem('munyeon:' + key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}
export function store(key, value) {
  try { localStorage.setItem('munyeon:' + key, JSON.stringify(value)); } catch {}
}

export async function readBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
