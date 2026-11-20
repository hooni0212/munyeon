export async function api(path, method = 'GET', data = {}) {
  const response = await fetch('/api' + path, {
    method,
    ...(method === 'GET' ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '요청을 완료하지 못했어요.');
  return result;
}
