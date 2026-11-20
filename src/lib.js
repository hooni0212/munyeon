import { useEffect, useState } from 'react';

export function paragraphs(text = '') {
  return text.trim().split(/\n[ \t]*\n+/).map(part => part.trim()).filter(Boolean);
}

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const timeFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// 마감은 한국 시간 기준 "YYYY-MM-DDTHH:mm" 문자열, 그 밖의 시각은 ISO 문자열이다.
export function when(value) {
  if (!value) return '미정';
  return dateFormat.format(new Date(value.length === 16 ? value + '+09:00' : value));
}
export function clock(value) {
  return value ? timeFormat.format(new Date(value)) : '';
}

export function parseRoute(hash = location.hash) {
  const [key = '', id = null] = hash.replace(/^#\/?/, '').split('/');
  return { key, id: id === null ? null : Number(id) };
}
export function href(key, id = null) {
  return '#/' + key + (id == null ? '' : '/' + id);
}
export function go(key, id = null) {
  const next = href(key, id);
  if (location.hash !== next) location.hash = next;
}
export function replace(key, id = null) {
  history.replaceState(null, '', href(key, id));
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
export function useScreenFocus(route) {
  useEffect(() => {
    scrollTo(0, 0);
    document.getElementById('screen-title')?.focus({ preventScroll: true });
  }, [route.key, route.id]);
}

export const statusTone = status => status === '검토 대기' ? 'amber' : status === '미제출' ? 'neutral' : '';
