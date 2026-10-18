import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface OAuthStatePayload {
  userId: string;
  email: string;
  /** Origen del frontend que abrió el popup (para postMessage dirigido). */
  origin: string | null;
  nonce: string;
  /** Expiración en ms epoch. */
  exp: number;
}

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const ALLOWED_ORIGINS = new Set([
  'http://localhost:8080',
  'http://localhost:8081',
  'http://localhost:5173',
  'https://andfuentez1.github.io',
]);

/** Mismas reglas que el CORS del servidor. */
export function isAllowedOrigin(origin: string | null | undefined): origin is string {
  if (!origin) { return false; }
  try {
    const parsed = new URL(origin);
    const normalized = `${parsed.protocol}//${parsed.host}`;
    if (ALLOWED_ORIGINS.has(normalized)) { return true; }
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.github.io');
  } catch {
    return false;
  }
}

const toBase64Url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function getOAuthStateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error('OAUTH_STATE_SECRET (o SUPABASE_SERVICE_ROLE_KEY) no configurado');
  }
  return secret;
}

export function signOAuthState(
  input: { userId: string; email: string; origin?: string | null },
  secret: string,
  now: number = Date.now()
): string {
  const payload: OAuthStatePayload = {
    userId: input.userId,
    email: input.email,
    origin: isAllowedOrigin(input.origin) ? input.origin : null,
    nonce: randomBytes(12).toString('base64url'),
    exp: now + OAUTH_STATE_TTL_MS,
  };
  const body = toBase64Url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

/** Devuelve el payload si la firma es válida y no expiró; si no, null. */
export function verifyOAuthState(
  token: string,
  secret: string,
  now: number = Date.now()
): OAuthStatePayload | null {
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) { return null; }

  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) { return null; }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<OAuthStatePayload>;
    if (
      typeof payload.userId !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp < now
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      email: payload.email,
      origin: isAllowedOrigin(payload.origin ?? null) ? (payload.origin as string) : null,
      nonce: String(payload.nonce ?? ''),
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Serializa un valor para incrustarlo seguro dentro de <script>. */
export function toScriptLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
