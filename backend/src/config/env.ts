import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),

  CORS_ORIGINS: z.string().default(''),

  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  RATE_LIMIT_PUBLIC_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_TOKEN_CREATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_TOKEN_CREATE_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_SENSITIVE_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_SENSITIVE_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_REPORT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_REPORT_MAX: z.coerce.number().int().positive().default(10),

  // Test-harness-only escape hatch (not in .env.example — never meant for a
  // real environment): every limiter is skipped whenever NODE_ENV === 'test'
  // by default, same as the pre-existing authRateLimiter carve-out, since
  // the integration suite's request volume from a single address would
  // otherwise trip every category. Setting this to 'true' lets one isolated
  // test file (tests/rateLimit.test.ts) actually exercise 429 behavior
  // without affecting the other ~30 test files, which never set it.
  RATE_LIMIT_TEST_ENFORCE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  // Two ways to supply the Firebase service-account credential — exactly
  // one is needed. FIREBASE_CREDENTIALS (the raw service-account JSON
  // content as the variable's value) is the one that works on a stateless
  // host like Render, which has no mounted-file mechanism for a plain
  // environment variable. FIREBASE_SERVICE_ACCOUNT_PATH (a path to a local
  // JSON file, never committed — .gitignore's "*service-account*.json")
  // remains for local dev convenience where the downloaded key already
  // sits on disk. If FIREBASE_CREDENTIALS is set, it takes priority.
  FIREBASE_CREDENTIALS: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),

  REMINDER_DISPATCH_CRON: z.string().default('*/1 * * * *'),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Startup-time failure, not a request path — safe to log full validation detail.
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
