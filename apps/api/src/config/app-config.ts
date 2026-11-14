import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  TICKET_TOKEN_ENC_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'TICKET_TOKEN_ENC_KEY must be 32 bytes, base64-encoded'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  COOKIE_SECURE: bool(false),
  /** Number of reverse proxies in front of the API (false/0 = none, true = 1). Netlify -> Railway = 2. */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => (!v || v === 'false' ? 0 : v === 'true' ? 1 : Number(v)))
    .refine((n) => Number.isInteger(n) && n >= 0 && n <= 5, 'TRUST_PROXY must be true, false or a hop count 0-5'),
  WEB_ORIGINS: z.string().default('http://localhost:5173'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  APP_TIMEZONE: z.string().default('Europe/Belgrade'),
  EMAIL_MODE: z.enum(['mock', 'resend', 'gmail']).default('mock'),
  /** Gmail app password (16 characters; spaces are ignored). Used when EMAIL_MODE=gmail. */
  EMAIL_APP_PASSWORD: z.string().optional().default(''),
  /** Gmail API (OAuth) – used instead of SMTP when set; needed where outbound SMTP is blocked. */
  GMAIL_CLIENT_ID: z.string().optional().default(''),
  GMAIL_CLIENT_SECRET: z.string().optional().default(''),
  GMAIL_REFRESH_TOKEN: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('Pozivnice <pozivnice@example.com>'),
  RESEND_API_KEY: z.string().optional().default(''),
  RESEND_WEBHOOK_SECRET: z.string().optional().default(''),
  EMAIL_EMBED_QR: bool(true),
  EMAIL_QUEUE_MODE: z.enum(['bullmq', 'inline']).default('bullmq'),
  UPLOAD_DIR: z.string().default('./uploads'),
  /** Optional: absolute/relative path of the built web app to serve from the API (single-origin deploys). */
  WEB_DIST_DIR: z.string().optional().default(''),
});

export class AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly port: number;
  readonly databaseUrl: string;
  /** PostgreSQL schema that holds the tables (from `?schema=` in DATABASE_URL). */
  readonly dbSchema: string;
  readonly redisUrl: string;
  readonly jwtAccessSecret: string;
  readonly ticketTokenEncKey: Buffer;
  readonly accessTokenTtlMinutes: number;
  readonly refreshTokenTtlDays: number;
  readonly cookieSecure: boolean;
  readonly trustProxy: number;
  readonly webOrigins: string[];
  readonly publicAppUrl: string;
  readonly timezone: string;
  readonly emailMode: 'mock' | 'resend' | 'gmail';
  readonly emailFrom: string;
  /** Bare address from EMAIL_FROM ("Name <a@b>" → "a@b"). */
  readonly emailFromAddress: string;
  readonly emailAppPassword: string;
  readonly gmailClientId: string;
  readonly gmailClientSecret: string;
  readonly gmailRefreshToken: string;
  readonly resendApiKey: string;
  readonly resendWebhookSecret: string;
  readonly emailEmbedQr: boolean;
  readonly emailQueueMode: 'bullmq' | 'inline';
  readonly uploadDir: string;
  readonly webDistDir: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const parsed = envSchema.safeParse(env);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Invalid environment configuration:\n${details}`);
    }
    const e = parsed.data;
    this.nodeEnv = e.NODE_ENV;
    this.isProduction = e.NODE_ENV === 'production';
    this.isTest = e.NODE_ENV === 'test';
    this.port = e.PORT;
    this.databaseUrl = e.DATABASE_URL;
    this.dbSchema = parseSchema(e.DATABASE_URL);
    this.redisUrl = e.REDIS_URL;
    this.jwtAccessSecret = e.JWT_ACCESS_SECRET;
    this.ticketTokenEncKey = Buffer.from(e.TICKET_TOKEN_ENC_KEY, 'base64');
    this.accessTokenTtlMinutes = e.ACCESS_TOKEN_TTL_MINUTES;
    this.refreshTokenTtlDays = e.REFRESH_TOKEN_TTL_DAYS;
    this.cookieSecure = this.isProduction ? true : e.COOKIE_SECURE;
    this.trustProxy = e.TRUST_PROXY;
    this.webOrigins = e.WEB_ORIGINS.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
    this.publicAppUrl = e.PUBLIC_APP_URL.replace(/\/+$/, '');
    this.timezone = e.APP_TIMEZONE;
    this.emailMode = e.EMAIL_MODE;
    this.emailFrom = e.EMAIL_FROM;
    this.emailFromAddress = (/<([^>]+)>/.exec(e.EMAIL_FROM)?.[1] ?? e.EMAIL_FROM).trim();
    this.emailAppPassword = e.EMAIL_APP_PASSWORD.replace(/\s+/g, '');
    this.gmailClientId = e.GMAIL_CLIENT_ID.trim();
    this.gmailClientSecret = e.GMAIL_CLIENT_SECRET.trim();
    this.gmailRefreshToken = e.GMAIL_REFRESH_TOKEN.trim();
    this.resendApiKey = e.RESEND_API_KEY;
    this.resendWebhookSecret = e.RESEND_WEBHOOK_SECRET;
    this.emailEmbedQr = e.EMAIL_EMBED_QR;
    this.emailQueueMode = e.EMAIL_QUEUE_MODE;
    this.uploadDir = e.UPLOAD_DIR;
    this.webDistDir = e.WEB_DIST_DIR;

    if (this.emailMode === 'resend') {
      if (!this.resendApiKey) throw new Error('EMAIL_MODE=resend requires RESEND_API_KEY');
      if (this.isProduction && !this.resendWebhookSecret) {
        throw new Error('EMAIL_MODE=resend in production requires RESEND_WEBHOOK_SECRET');
      }
    }
    if (this.emailMode === 'gmail') {
      const oauth = [this.gmailClientId, this.gmailClientSecret, this.gmailRefreshToken];
      if (oauth.some(Boolean) && !oauth.every(Boolean)) {
        throw new Error('Gmail API needs all of GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN');
      }
      if (!this.gmailRefreshToken && !this.emailAppPassword) {
        throw new Error('EMAIL_MODE=gmail requires EMAIL_APP_PASSWORD (SMTP) or GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN (Gmail API)');
      }
      if (!/^[^@\s]+@[^@\s]+$/.test(this.emailFromAddress)) {
        throw new Error('EMAIL_MODE=gmail requires EMAIL_FROM to contain the Gmail address, e.g. "Name <you@gmail.com>"');
      }
    }
    if (this.isProduction && !this.publicAppUrl.startsWith('https://')) {
      throw new Error('PUBLIC_APP_URL must use https:// in production');
    }
  }
}

function parseSchema(databaseUrl: string): string {
  try {
    const schema = new URL(databaseUrl).searchParams.get('schema') ?? 'public';
    // The name is interpolated into raw SQL identifiers – allow only safe characters.
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('unsafe');
    return schema;
  } catch {
    throw new Error('DATABASE_URL has an invalid `schema` parameter');
  }
}
