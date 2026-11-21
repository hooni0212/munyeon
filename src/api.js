export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// /api/session 같은 공통 경로는 그대로, 나머지는 /api/v1 아래로 보낸다.
export async function api(path, method = 'GET', data) {
  const url = path.startsWith('/session') || path.startsWith('/login') || path.startsWith('/logout') ? '/api' + path : '/api/v1' + path;
  let response;
  try {
    response = await fetch(url, {
      method,
      ...(method === 'GET' || method === 'DELETE' ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data ?? {}),
      }),
    });
  } catch {
    throw new ApiError('서버에 연결하지 못했어요. 네트워크를 확인해 주세요.', 0, 'NETWORK');
  }
  if (response.status === 204) return null;
  let result;
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok) throw new ApiError(result.error || '요청을 완료하지 못했어요.', response.status, result.code);
  return result;
}
