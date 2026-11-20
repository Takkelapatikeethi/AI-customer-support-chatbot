const LOCAL_ORIGIN = 'http://localhost:3000';

function getConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = env.APP_ORIGIN || LOCAL_ORIGIN;
  let url;
  try { url = new URL(origin); } catch { throw new Error('APP_ORIGIN must be a valid origin.'); }
  if (url.origin !== origin || url.username || url.password) throw new Error('APP_ORIGIN must contain only scheme, host and optional port.');
  const trustProxyHops = Number(env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 3) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 3.');
  const resetEnabled = env.AUTH_PASSWORD_RESET_ENABLED !== 'false';
  if (env.AUTH_PASSWORD_RESET_ENABLED && !['true', 'false'].includes(env.AUTH_PASSWORD_RESET_ENABLED)) throw new Error('AUTH_PASSWORD_RESET_ENABLED must be true or false.');
  if (production) {
    if (!env.APP_ORIGIN || url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Production requires an HTTPS APP_ORIGIN on your public domain.');
    if (env.AWS_PROFILE) throw new Error('Remove AWS_PROFILE in production; configure a workload IAM role.');
    if (resetEnabled && (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM)) throw new Error('Configure reset email or explicitly set AUTH_PASSWORD_RESET_ENABLED=false.');
  }
  return { production, origin, trustProxyHops, resetEnabled };
}

module.exports = { getConfig };
