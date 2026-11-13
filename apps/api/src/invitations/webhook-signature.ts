import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies a Svix-style webhook signature (the scheme Resend uses).
 *
 *   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
 *   signature      = base64( HMAC-SHA256( base64decode(secret without "whsec_"), signed content ) )
 *   header         = space-separated list of `v1,<signature>` (several during key rotation)
 *
 * The timestamp must be within the tolerance window, which blocks replaying
 * a captured request later.
 */
export function verifyWebhookSignature(input: {
  secret: string;
  id: string | undefined;
  timestamp: string | undefined;
  signatureHeader: string | undefined;
  rawBody: Buffer | string;
  now?: Date;
  toleranceSeconds?: number;
}): boolean {
  const { secret, id, timestamp, signatureHeader } = input;
  if (!secret || !id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - ts) > (input.toleranceSeconds ?? 300)) return false;

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  if (key.length === 0) return false;
  const body = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();

  for (const part of signatureHeader.split(' ')) {
    const [version, signature] = part.split(',');
    if (version !== 'v1' || !signature) continue;
    const candidate = Buffer.from(signature, 'base64');
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

/** Builds a valid signature header – used by tests and local webhook simulation. */
export function signWebhook(secret: string, id: string, timestamp: string, rawBody: string): string {
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64')}`;
}
