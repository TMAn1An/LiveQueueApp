import { prisma } from '../../src/config/prisma';

/** Cascades through Staff and Session via the schema's onDelete: Cascade. */
export async function resetDb() {
  await prisma.organization.deleteMany({});
}
