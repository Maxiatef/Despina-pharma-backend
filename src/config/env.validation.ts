/**
 * Checked once at startup (ConfigModule.validate). The app refuses to start with a
 * broken configuration instead of failing later on the first request.
 */
export function validateEnv(env: Record<string, unknown>) {
  const errors: string[] = [];
  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'APP_SECRET'];
  for (const key of required) if (!env[key]) errors.push(`${key} is required`);

  if (typeof env.APP_SECRET === 'string' && env.APP_SECRET.length < 32) errors.push('APP_SECRET must be at least 32 characters');
  for (const key of ['DB_PORT', 'PORT', 'UPLOAD_MAX_MB', 'UPLOAD_MAX_FILES', 'SESSION_TTL_DAYS']) {
    if (env[key] !== undefined && env[key] !== '' && Number.isNaN(Number(env[key]))) errors.push(`${key} must be a number`);
  }
  const provider = env.EMAIL_PROVIDER ?? 'none';
  if (!['none', 'resend'].includes(String(provider))) errors.push('EMAIL_PROVIDER must be "none" or "resend"');
  // TODO(resend): once implemented, require RESEND_API_KEY and EMAIL_FROM when EMAIL_PROVIDER=resend.
  if (env.NODE_ENV === 'production' && env.SCAN_MODE === 'skip') errors.push('SCAN_MODE=skip is not allowed in production');

  if (errors.length) throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  return env;
}
