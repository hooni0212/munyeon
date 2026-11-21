// 서버와 화면이 함께 쓰는 본문 위치 계산. 위치는 본문 전체 기준 글자 오프셋이다.

export const STAGES = ['s1', 's2', 's3', 's4'];
export const DEFAULT_STAGE_NAMES = { s1: '구상', s2: '자료 조사', s3: '초안 작성', s4: '수정·점검' };
export const ACTIVITIES = { ideas: '아이디어 구상', explain: '개념·자료 설명', feedback: '초안 피드백', write: '문장 대신 작성' };
export const USAGES = { idea: '아이디어 참고', direct: '그대로 활용', reworked: '고쳐서 활용', not_adopted: '검토 후 미반영' };

export function defaultRules() {
  return Object.fromEntries(STAGES.map(stage => [stage,
    Object.fromEntries(Object.keys(ACTIVITIES).map(activity => [activity, activity === 'write' ? 'restricted' : 'allowed']))]));
}

export function normalizeText(text = '') {
  return String(text).replace(/\r\n?/g, '\n');
}

// 빈 줄로 나눈 문단의 본문 내 위치. 앞뒤 공백은 범위에서 뺀다.
export function paragraphRanges(body = '') {
  const ranges = [];
  const pattern = /\n[ \t]*\n+/g;
  let cursor = 0;
  const push = (from, to) => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(body[start])) start++;
    while (end > start && /\s/.test(body[end - 1])) end--;
    if (end > start) ranges.push({ index: ranges.length, start, end, text: body.slice(start, end) });
  };
  for (let match; (match = pattern.exec(body));) {
    push(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  push(cursor, body.length);
  return ranges;
}

export function paragraphAt(body, offset) {
  const ranges = paragraphRanges(body);
  return ranges.find(range => offset >= range.start && offset <= range.end) ??
    ranges.find(range => range.start >= offset) ?? ranges.at(-1) ?? null;
}

// 편집 전후 본문을 비교해 범위를 옮긴다. 범위 안이 모두 지워지면 위치를 잃은 것으로 본다.
export function shiftItems(items, before, after) {
  if (before === after) return items;
  let prefix = 0;
  const limit = Math.min(before.length, after.length);
  while (prefix < limit && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < limit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const oldEdge = before.length - suffix;
  const delta = after.length - before.length;
  const map = (position, isEnd) => position <= prefix ? position
    : position >= oldEdge ? position + delta : isEnd ? after.length - suffix : prefix;
  return items.map(item => {
    if (item.start == null) return item;
    const start = map(item.start, false);
    const end = map(item.end, true);
    if (end - start < 1 || !after.slice(start, end).trim()) return { ...item, start: null, end: null, status: 'lost' };
    return { ...item, start, end, quote: after.slice(start, end), status: 'ok' };
  });
}

// 저장할 때 서버가 다시 확인한다. 위치의 글자가 다르면 원문으로 가장 가까운 위치를 찾는다.
export function relocate(item, body) {
  if (item.start == null || item.end == null) {
    if (!item.quote) return { ...item, start: null, end: null, status: 'unanchored' };
    return findQuote(item, body);
  }
  if (body.slice(item.start, item.end) === item.quote) return { ...item, status: 'ok' };
  return findQuote(item, body);
}

function findQuote(item, body) {
  if (!item.quote) return { ...item, start: null, end: null, status: 'unanchored' };
  let best = -1;
  for (let at = body.indexOf(item.quote); at >= 0; at = body.indexOf(item.quote, at + 1)) {
    if (best < 0 || Math.abs(at - (item.start ?? 0)) < Math.abs(best - (item.start ?? 0))) best = at;
  }
  if (best < 0) return { ...item, start: null, end: null, status: 'lost' };
  return { ...item, start: best, end: best + item.quote.length, status: 'ok' };
}

// 겹치는 강조 범위를 경계마다 잘라 화면에 그릴 조각으로 만든다.
export function segments(body, items) {
  const anchored = items.filter(item => item.start != null && item.end > item.start);
  const cuts = new Set([0, body.length]);
  for (const item of anchored) {
    cuts.add(Math.max(0, Math.min(body.length, item.start)));
    cuts.add(Math.max(0, Math.min(body.length, item.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [start, end] = [points[i], points[i + 1]];
    if (end <= start) continue;
    result.push({ start, end, text: body.slice(start, end),
      items: anchored.filter(item => item.start <= start && item.end >= end) });
  }
  return result;
}

// 문단과 AI 답변의 글자 3-gram 포함률. 높다고 AI가 썼다는 뜻은 아니며 확인 후보로만 쓴다.
function grams(text) {
  const clean = String(text).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const set = new Set();
  for (let i = 0; i + 3 <= clean.length; i++) set.add(clean.slice(i, i + 3));
  return set;
}

export function similarity(paragraph, reply) {
  const a = grams(paragraph);
  if (a.size < 8) return 0;
  const b = grams(reply);
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return shared / a.size;
}

export const SIMILAR_THRESHOLD = 0.3;

// 학생이 이미 연결한 대화는 빼고, 문단마다 유사한 대화를 최대 두 건 찾는다.
export function similarTurns(body, turns, items = []) {
  const found = [];
  for (const paragraph of paragraphRanges(body)) {
    const linked = new Set(items.filter(item => item.start != null && item.start < paragraph.end && item.end > paragraph.start)
      .flatMap(item => item.turnIds ?? []));
    turns.filter(turn => turn.reply && !linked.has(turn.id))
      .map(turn => ({ turnId: turn.id, score: similarity(paragraph.text, turn.reply) }))
      .filter(match => match.score >= SIMILAR_THRESHOLD)
      .sort((a, b) => b.score - a.score).slice(0, 2)
      .forEach(match => found.push({ ...match, paragraph: paragraph.index, start: paragraph.start, end: paragraph.end,
        key: match.turnId + ':' + paragraph.text.slice(0, 40), score: Math.round(match.score * 100) / 100 }));
  }
  return found;
}
