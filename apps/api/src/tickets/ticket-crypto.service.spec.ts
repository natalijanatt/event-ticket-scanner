import { buildTicketUrl, extractTicketToken, isTicketToken } from '@event-platform/shared';
import { AppConfig } from '../config/app-config';
import { TicketCryptoService } from './ticket-crypto.service';

describe('TicketCryptoService – ticket generation', () => {
  const crypto = new TicketCryptoService(new AppConfig());
  const ticketId = '3f0c1a52-8f0e-4b7a-9b43-0d6f6f1c2a11';

  it('creates a 256-bit URL-safe token', () => {
    const { token } = crypto.createCredentials(ticketId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(isTicketToken(token)).toBe(true);
  });

  it('never repeats a token or a hash', () => {
    const tokens = new Set<string>();
    const hashes = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = crypto.createCredentials(ticketId);
      tokens.add(c.token);
      hashes.add(c.tokenHash);
    }
    expect(tokens.size).toBe(2000);
    expect(hashes.size).toBe(2000);
  });

  it('stores only a SHA-256 hash that does not contain the token', () => {
    const { token, tokenHash, tokenCipher } = crypto.createCredentials(ticketId);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(crypto.hashToken(token));
    expect(tokenHash).not.toContain(token);
    expect(tokenCipher).not.toContain(token);
  });

  it('decrypts the stored cipher back to the token (authorized re-send)', () => {
    const { token, tokenCipher } = crypto.createCredentials(ticketId);
    expect(crypto.decrypt(tokenCipher, ticketId)).toBe(token);
  });

  it('uses a fresh IV, so equal tokens encrypt differently', () => {
    expect(crypto.encrypt('same-token', ticketId)).not.toBe(crypto.encrypt('same-token', ticketId));
  });

  it('refuses a cipher moved to another ticket (AAD binding)', () => {
    const { tokenCipher } = crypto.createCredentials(ticketId);
    expect(() => crypto.decrypt(tokenCipher, '11111111-2222-4333-8444-555555555555')).toThrow();
  });

  it('refuses a tampered cipher', () => {
    const { tokenCipher } = crypto.createCredentials(ticketId);
    const parts = tokenCipher.split('.');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
    expect(() => crypto.decrypt(parts.join('.'), ticketId)).toThrow();
  });

  it('refuses a cipher encrypted under a different key', () => {
    const other = new TicketCryptoService(new AppConfig({ ...process.env, TICKET_TOKEN_ENC_KEY: Buffer.alloc(32, 1).toString('base64') }));
    const { tokenCipher } = other.createCredentials(ticketId);
    expect(() => crypto.decrypt(tokenCipher, ticketId)).toThrow();
  });

  it('builds the QR URL from the public base URL and nothing personal', () => {
    const { token } = crypto.createCredentials(ticketId);
    expect(crypto.ticketUrl(token)).toBe(`https://tickets.example.com/t/${token}`);
  });

  it('creates human-readable references without ambiguous characters', () => {
    for (let i = 0; i < 200; i++) expect(crypto.createReference()).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
  });
});

describe('token validation (QR content)', () => {
  const token = 'A'.repeat(43);

  it('accepts a ticket URL and a bare token', () => {
    expect(extractTicketToken(buildTicketUrl('https://tickets.example.com/', token))).toBe(token);
    expect(extractTicketToken(`  http://localhost:5173/t/${token}/ `)).toBe(token);
    expect(extractTicketToken(token)).toBe(token);
  });

  it.each([
    ['empty', ''],
    ['other site path', `https://tickets.example.com/x/${token}`],
    ['short token', 'https://tickets.example.com/t/abc'],
    ['long token', `https://tickets.example.com/t/${token}A`],
    ['illegal characters', `https://tickets.example.com/t/${'A'.repeat(42)}!`],
    ['javascript scheme', `javascript:alert(1)//t/${token}`],
    ['wifi QR', 'WIFI:S:Club;T:WPA;P:secret;;'],
    ['plain text', 'Marko Petrović'],
    ['extra path', `https://tickets.example.com/t/${token}/extra`],
  ])('rejects %s', (_name, value) => {
    expect(extractTicketToken(value)).toBeNull();
  });
});
