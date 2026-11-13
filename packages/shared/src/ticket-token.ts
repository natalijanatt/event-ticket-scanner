/**
 * Ticket tokens are 32 random bytes encoded as base64url → exactly 43 chars.
 * The QR code carries `https://<host>/t/<token>`.
 */
export const TICKET_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

export function isTicketToken(value: string): boolean {
  return TICKET_TOKEN_REGEX.test(value);
}

/**
 * Extracts the ticket token from scanned QR content. Accepts a full ticket
 * URL (`…/t/<token>`) or a bare token. Returns null for anything else, so
 * random QR codes (menus, Wi-Fi, other ticketing systems) never reach the API.
 */
export function extractTicketToken(raw: string): string | null {
  const text = raw.trim();
  if (isTicketToken(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const match = /^\/t\/([A-Za-z0-9_-]{43})\/?$/.exec(url.pathname);
  return match ? match[1] : null;
}

export function buildTicketUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/t/${token}`;
}
