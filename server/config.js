export function deploymentConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const host = env.MUNYEON_HOST || '127.0.0.1';
  const port = Number(env.PORT || 4311);
  const aiDailyLimit = Number(env.MUNYEON_AI_DAILY_LIMIT || 120);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT를 확인하세요.');
  if (!Number.isInteger(aiDailyLimit) || aiDailyLimit < 1) throw new Error('MUNYEON_AI_DAILY_LIMIT를 확인하세요.');
  if (!production && !['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('체험 모드는 로컬 주소에서 실행합니다.');
  }
  let origin = null;
  if (production) {
    let address;
    try { address = new URL(env.MUNYEON_ORIGIN || ''); } catch {}
    if (address?.protocol !== 'https:' || address.origin !== env.MUNYEON_ORIGIN) {
      throw new Error('MUNYEON_ORIGIN에 https://도메인 형식의 주소를 설정하세요.');
    }
    origin = address.origin;
  }
  return { host, port, origin, aiDailyLimit, aiEnabled: env.MUNYEON_AI_ENABLED === '1', trustProxy: production && env.MUNYEON_TRUST_PROXY === '1' };
}
