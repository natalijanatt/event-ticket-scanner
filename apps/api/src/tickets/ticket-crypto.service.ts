import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { buildTicketUrl } from '@event-platform/shared';
import { randomToken, sha256Hex } from '../common/crypto';
import { AppConfig } from '../config/app-config';

// Unambiguous alphabet for references read aloud at a noisy entrance (no 0/O, 1/I/L).
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export interface TicketCredentials {
  /** Plaintext secret – exists only in memory, in the QR code and in the e-mail. */
  token: string;
  tokenHash: string;
  tokenCipher: string;
}

/**
 * Ticket secrets.
 *
 *  token       32 bytes from the OS CSPRNG, base64url (43 chars, 256 bits).
 *  tokenHash   SHA-256 of the token – the ONLY thing used to look a ticket up.
 *              A fast hash is appropriate here because the input is a
 *              high-entropy random value, not a human password.
 *  tokenCipher AES-256-GCM encryption of the token under a key that lives in
 *              the environment, not the database. It exists for one purpose:
 *              rebuilding the ticket link when an organizer re-sends an
 *              invitation. A database leak alone therefore reveals no usable
 *              ticket. The ticket id is bound as AAD, so a ciphertext cannot
 *              be swapped onto another ticket row.
 */
@Injectable()
export class TicketCryptoService {
  constructor(private readonly config: AppConfig) {}

  createCredentials(ticketId: string): TicketCredentials {
    const token = randomToken(32);
    return { token, tokenHash: this.hashToken(token), tokenCipher: this.encrypt(token, ticketId) };
  }

  hashToken(token: string): string {
    return sha256Hex(token);
  }

  encrypt(token: string, ticketId: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.config.ticketTokenEncKey, iv);
    cipher.setAAD(Buffer.from(ticketId, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  /** Throws if the ciphertext was tampered with, moved to another ticket, or the key changed. */
  decrypt(tokenCipher: string, ticketId: string): string {
    const [version, iv, tag, ciphertext] = tokenCipher.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unsupported ticket cipher format');
    const decipher = createDecipheriv('aes-256-gcm', this.config.ticketTokenEncKey, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(ticketId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  }

  ticketUrl(token: string): string {
    return buildTicketUrl(this.config.publicAppUrl, token);
  }

  /** Human-readable ticket reference, e.g. `K7QM2-XRD4H`. An identifier, not a credential. */
  createReference(): string {
    let out = '';
    for (let i = 0; i < 10; i++) {
      if (i === 5) out += '-';
      out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
    }
    return out;
  }
}
