/* eslint-disable no-console -- a command-line script: stdout is its interface */
/**
 * DEVELOPMENT ONLY. Creates (or resets the password of) a ready-to-use owner
 * account, organization, queue and counter in a LOCAL database, so the
 * dashboard can be opened without going through registration and email
 * verification.
 *
 *   npx tsx src/scripts/seedDevOwner.ts
 *
 * The password is never written here: it is read from
 * DEV_SEED_OWNER_PASSWORD in backend/.env (which is not committed) and is
 * never printed. Because this script sets a known password on an owner
 * account, it refuses to run unless NODE_ENV is "development" AND the
 * database is on this machine.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../utils/password';
import { getEffectivePermissions } from '../constants/permissions';
import { organizationNameKey } from '../utils/organizationName';
import { passwordSchema } from '../validators/auth.validators';

const PASSWORD_VARIABLE = 'DEV_SEED_OWNER_PASSWORD';
const LOCAL_DATABASE_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const OWNER_EMAIL = 'admin@livequeue.local';
const ORGANIZATION_NAME = 'LiveQueue Local Demo';

class SeedRefusedError extends Error {}

/** Every reason not to run, checked before a database connection is opened. */
function readSeedPassword(): string {
  if (process.env.NODE_ENV !== 'development') {
    throw new SeedRefusedError(
      `This script only runs with NODE_ENV=development (found "${process.env.NODE_ENV ?? 'unset'}").`,
    );
  }

  let databaseHost: string;
  try {
    databaseHost = new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    throw new SeedRefusedError('DATABASE_URL is missing or is not a valid URL.');
  }
  if (!LOCAL_DATABASE_HOSTS.includes(databaseHost)) {
    throw new SeedRefusedError(
      `DATABASE_URL points at "${databaseHost}", which is not this machine. ` +
        'This script sets a known password on an owner account and must never touch a shared or production database.',
    );
  }

  const password = process.env[PASSWORD_VARIABLE];
  if (!password) {
    throw new SeedRefusedError(
      `${PASSWORD_VARIABLE} is not set. Add it to backend/.env (see .env.example) with a password of your choice, then run this again.`,
    );
  }
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) {
    // Only the rule that failed is reported — never the value itself.
    throw new SeedRefusedError(
      `${PASSWORD_VARIABLE} does not meet the password policy: ${parsed.error.issues[0]?.message ?? 'invalid password.'}`,
    );
  }
  return parsed.data;
}

async function seed(prisma: PrismaClient, password: string): Promise<void> {
  const nameKey = organizationNameKey(ORGANIZATION_NAME);
  let org = await prisma.organization.findUnique({ where: { nameKey } });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: ORGANIZATION_NAME,
        nameKey,
        timezone: 'UTC',
        onboardingCompletedAt: new Date(),
      },
    });
    console.log(`Created organization: ${org.name} (${org.id})`);
  }

  const existingStaff = await prisma.staff.findUnique({ where: { email: OWNER_EMAIL } });
  const passwordHash = await hashPassword(password);

  if (!existingStaff) {
    const staff = await prisma.staff.create({
      data: {
        organizationId: org.id,
        name: 'Local Admin',
        email: OWNER_EMAIL,
        passwordHash,
        role: 'OWNER',
        permissions: getEffectivePermissions('OWNER'),
        status: 'ACTIVE',
      },
    });
    console.log(`Created active owner account: ${staff.email} (${staff.id})`);
  } else {
    await prisma.staff.update({
      where: { id: existingStaff.id },
      data: { passwordHash, status: 'ACTIVE' },
    });
    console.log(`Updated owner account: ${existingStaff.email}`);
  }

  // Create a default queue and counter if none exist
  const existingQueue = await prisma.queue.findFirst({ where: { organizationId: org.id } });

  if (!existingQueue) {
    const queue = await prisma.queue.create({
      data: {
        organizationId: org.id,
        name: 'General Admissions',
        tokenPrefix: 'A',
        status: 'ACTIVE',
      },
    });
    console.log(`Created demo queue: ${queue.name} (${queue.id})`);

    await prisma.counter.create({
      data: { queueId: queue.id, name: 'Counter 1', status: 'ACTIVE' },
    });
    console.log('Created demo counter: Counter 1');
  }

  console.log('\n=== Local Development Sign-in ===');
  console.log(`Email:    ${OWNER_EMAIL}`);
  console.log(`Password: the value of ${PASSWORD_VARIABLE} in backend/.env`);
  console.log('=================================\n');
}

async function main(): Promise<void> {
  const password = readSeedPassword();
  const prisma = new PrismaClient();
  try {
    await seed(prisma, password);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  if (err instanceof SeedRefusedError) {
    console.error(`\nseedDevOwner refused to run: ${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
