import { Prisma, type Device, type TokenStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { buildDisplayFormFields, fetchFormFieldDefs, type DisplayFormField } from '../utils/formFieldDisplay';

const ACTIVE_TOKEN_STATUSES: TokenStatus[] = ['WAITING', 'CALLED', 'IN_PROGRESS'];
/** Priority order for picking a customerContext token when a device somehow
 * has more than one active token for this organization at once — possible
 * only across different queues (Issue #9 guarantees at most one active
 * token per device *per queue*, not per organization overall). */
const ACTIVE_STATUS_PRIORITY: TokenStatus[] = ['WAITING', 'CALLED', 'IN_PROGRESS'];

export interface CustomerContext {
  tokenId: string;
  serialNumber: string;
  status: TokenStatus;
  queue: { id: string; name: string };
  /** V2 Checkpoint 5 (ADR-027): the full multi-service selection. */
  services: { id: string; name: string }[];
  formFields: DisplayFormField[];
  createdAt: Date;
  calledAt: Date | null;
  startedAt: Date | null;
}

/**
 * Idempotent get-or-create: a device that registers twice (or is implicitly
 * resolved during token creation without a prior explicit register call)
 * just gets its lastSeenAt bumped, never a duplicate row (ADR-011).
 */
export async function registerDevice(deviceIdentifier: string) {
  return prisma.device.upsert({
    where: { deviceIdentifier },
    create: { deviceIdentifier, lastSeenAt: new Date() },
    update: { lastSeenAt: new Date() },
  });
}

/** The shape the dashboard consumes — `status` here is this organization's
 * block state (from OrganizationDeviceBlock), never the raw global
 * Device.status column (see the OrganizationDeviceBlock model comment in
 * schema.prisma for why that column is no longer authoritative). */
function toDeviceResponse(device: Device, isBlocked: boolean, customerContext: CustomerContext | null = null) {
  return {
    id: device.id,
    deviceIdentifier: device.deviceIdentifier,
    status: isBlocked ? ('BLOCKED' as const) : ('ACTIVE' as const),
    lastSeenAt: device.lastSeenAt,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
    customerContext,
  };
}

type CustomerContextTokenRow = {
  id: string;
  serialNumber: string;
  status: TokenStatus;
  formData: Prisma.JsonValue;
  queueId: string;
  formVersion: number;
  deviceId: string;
  createdAt: Date;
  calledAt: Date | null;
  startedAt: Date | null;
  queue: { id: string; name: string };
  tokenServices: { service: { id: string; serviceName: string } }[];
};

const CUSTOMER_CONTEXT_TOKEN_SELECT = {
  id: true,
  serialNumber: true,
  status: true,
  formData: true,
  queueId: true,
  formVersion: true,
  deviceId: true,
  createdAt: true,
  calledAt: true,
  startedAt: true,
  queue: { select: { id: true, name: true } },
  // V2 Checkpoint 5 (ADR-027): the full multi-service selection.
  tokenServices: { select: { service: { select: { id: true, serviceName: true } } } },
} satisfies Prisma.TokenSelect;

/**
 * Issue #4 approved priority: WAITING > CALLED > IN_PROGRESS > most recent
 * historical token, scoped to the authenticated organization AND the
 * device — never another organization's token (CLAUDE.md Rule 4).
 *
 * Prisma cannot express "custom enum priority, else fall back to most
 * recent" in a single relation query, so this runs as two bounded,
 * non-N+1 queries for the whole page (never one query per device):
 *   1. every active token (WAITING/CALLED/IN_PROGRESS) for these devices —
 *      realistically a handful of rows, picked per device by priority
 *      in memory.
 *   2. for devices with no active token, the single most recent token per
 *      device via `distinct: ['deviceId']` + `orderBy: createdAt desc` —
 *      Postgres/Prisma's native "latest row per group" pattern, still one
 *      query regardless of how many devices need it.
 */
async function fetchCustomerContexts(
  organizationId: string,
  deviceIds: string[],
): Promise<Map<string, CustomerContext | null>> {
  const result = new Map<string, CustomerContext | null>();
  if (deviceIds.length === 0) {
    return result;
  }

  const activeCandidates = (await prisma.token.findMany({
    where: { deviceId: { in: deviceIds }, organizationId, status: { in: ACTIVE_TOKEN_STATUSES } },
    orderBy: { createdAt: 'desc' },
    select: CUSTOMER_CONTEXT_TOKEN_SELECT,
  })) as CustomerContextTokenRow[];

  const activeByDevice = new Map<string, CustomerContextTokenRow>();
  for (const priorityStatus of ACTIVE_STATUS_PRIORITY) {
    for (const token of activeCandidates) {
      if (token.status === priorityStatus && !activeByDevice.has(token.deviceId)) {
        activeByDevice.set(token.deviceId, token);
      }
    }
  }

  const devicesNeedingHistory = deviceIds.filter((id) => !activeByDevice.has(id));
  const historicalCandidates = devicesNeedingHistory.length
    ? ((await prisma.token.findMany({
        where: { deviceId: { in: devicesNeedingHistory }, organizationId },
        orderBy: { createdAt: 'desc' },
        distinct: ['deviceId'],
        select: CUSTOMER_CONTEXT_TOKEN_SELECT,
      })) as CustomerContextTokenRow[])
    : [];
  const historicalByDevice = new Map(historicalCandidates.map((t) => [t.deviceId, t]));

  const chosenTokens = deviceIds
    .map((id) => activeByDevice.get(id) ?? historicalByDevice.get(id))
    .filter((t): t is CustomerContextTokenRow => t !== undefined);

  const formFieldDefs = await fetchFormFieldDefs(
    chosenTokens.map((t) => ({ queueId: t.queueId, formVersion: t.formVersion })),
  );

  for (const deviceId of deviceIds) {
    const token = activeByDevice.get(deviceId) ?? historicalByDevice.get(deviceId);
    if (!token) {
      result.set(deviceId, null);
      continue;
    }
    result.set(deviceId, {
      tokenId: token.id,
      serialNumber: token.serialNumber,
      status: token.status,
      queue: token.queue,
      services: token.tokenServices.map((ts) => ({ id: ts.service.id, name: ts.service.serviceName })),
      formFields: buildDisplayFormFields(token.queueId, token.formVersion, token.formData, formFieldDefs),
      createdAt: token.createdAt,
      calledAt: token.calledAt,
      startedAt: token.startedAt,
    });
  }
  return result;
}

/**
 * Device is a deliberately global identity with no organizationId (ADR-011 /
 * ADR-016 decision 6) — the identifier itself is still a platform-wide
 * concept. But blocking is now organization-scoped (OrganizationDeviceBlock),
 * so this listing is scoped to devices that have actually interacted with
 * the authenticated organization's queues (via Token), and each device's
 * `status` reflects only this organization's block relationship — never
 * another organization's. A device is never shown merely because a different
 * organization has blocked it.
 */
export async function listDevices(
  organizationId: string,
  page: number,
  pageSize: number,
  status?: 'ACTIVE' | 'BLOCKED',
  search?: string,
) {
  const where: Prisma.DeviceWhereInput = {
    // Tenant scope: a top-level (AND-ed) condition that every other clause
    // below is combined *with*, never OR-ed against — so no search term can
    // surface a device that never interacted with this organization.
    tokens: { some: { organizationId } },
    ...(status
      ? {
          organizationBlocks: {
            [status === 'BLOCKED' ? 'some' : 'none']: { organizationId },
          },
        }
      : {}),
    // Searchable fields are limited to what this page already displays: the
    // device identifier, the token serial number, and the queue name. The
    // customer-context form fields are deliberately NOT searched — they live
    // in Token.formData as arbitrary operator-defined JSON, and turning that
    // into a query surface would mean searching customer PII that this page
    // only ever renders for an already-selected device.
    //
    // Each relation clause repeats `organizationId` so a match can only ever
    // come from this organization's own tokens/queues, even though the
    // top-level scope above already guarantees the device itself is in range.
    ...(search
      ? {
          OR: [
            { deviceIdentifier: { contains: search, mode: 'insensitive' as const } },
            {
              tokens: {
                some: { organizationId, serialNumber: { contains: search, mode: 'insensitive' as const } },
              },
            },
            {
              tokens: {
                some: {
                  organizationId,
                  queue: { name: { contains: search, mode: 'insensitive' as const } },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [devices, total] = await Promise.all([
    prisma.device.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { organizationBlocks: { where: { organizationId } } },
    }),
    prisma.device.count({ where }),
  ]);

  const customerContexts = await fetchCustomerContexts(
    organizationId,
    devices.map((d) => d.id),
  );

  return {
    data: devices.map((d) =>
      toDeviceResponse(d, d.organizationBlocks.length > 0, customerContexts.get(d.id) ?? null),
    ),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/**
 * Blocking is an upsert on the (organizationId, deviceId) compound unique key
 * — blocking an already-blocked device for the same organization is
 * idempotent, never creates a duplicate row.
 *
 * Prisma 6.12 does not compile this compound-key upsert into a native
 * Postgres ON CONFLICT — it runs as a SELECT existence check followed by an
 * INSERT, both inside one transaction (confirmed by inspecting the actual
 * emitted SQL). Two genuinely concurrent first-time block requests for the
 * same (organizationId, deviceId) can therefore both pass the existence
 * check before either commits; the loser's INSERT then hits the unique
 * constraint and Prisma throws P2002. The database is never wrong (the
 * constraint guarantees exactly one row either way) — but without this catch,
 * the loser's HTTP response would be a spurious 409 CONFLICT instead of the
 * idempotent 200 the caller actually asked for (the requested state — this
 * organization has blocked this device — is already true by the time the
 * error is thrown). Scoped narrowly to P2002 on OrganizationDeviceBlock
 * specifically, so an unrelated constraint violation still propagates.
 */
export async function blockDevice(organizationId: string, deviceId: string) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) {
    throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }

  try {
    await prisma.organizationDeviceBlock.upsert({
      where: { organizationId_deviceId: { organizationId, deviceId } },
      create: { organizationId, deviceId },
      update: {},
    });
  } catch (error) {
    const isConcurrentBlockRace =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      error.meta?.modelName === 'OrganizationDeviceBlock';
    if (!isConcurrentBlockRace) {
      throw error;
    }
  }

  return toDeviceResponse(device, true);
}

/**
 * Deletes only the block row belonging to (organizationId, deviceId) — never
 * touches another organization's block, never touches the global Device row.
 * A device that isn't blocked by this organization (whether it's blocked by
 * a *different* organization, or not blocked at all, or doesn't exist)
 * deletes zero rows, which is reported as 404 — the same
 * hide-cross-tenant-existence convention used elsewhere (e.g.
 * findCounterScoped/findTokenScoped), so this never reveals whether another
 * organization has a block on the device.
 */
export async function unblockDevice(organizationId: string, deviceId: string) {
  const result = await prisma.organizationDeviceBlock.deleteMany({
    where: { organizationId, deviceId },
  });
  if (result.count === 0) {
    throw new AppError(404, 'DEVICE_BLOCK_NOT_FOUND', 'No block found for this device.');
  }

  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) {
    throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }
  return toDeviceResponse(device, false);
}

/**
 * Phase 7 Step 7. One row per device — a device's FCM token can rotate
 * (reinstall, Firebase-initiated refresh), so registering a new one
 * replaces the old one via upsert on the unique deviceId, never
 * accumulates rows. Resolves/creates the Device the same way
 * registerDevice does (self-asserted deviceIdentifier — there is no device
 * authentication mechanism in this codebase, ADR-011), so a device
 * registering an FCM token can only ever touch its own row.
 */
export async function registerFcmToken(deviceIdentifier: string, fcmToken: string) {
  const device = await registerDevice(deviceIdentifier);

  const record = await prisma.deviceFcmToken.upsert({
    where: { deviceId: device.id },
    create: { deviceId: device.id, fcmToken },
    update: { fcmToken },
  });

  return { deviceId: device.id, updatedAt: record.updatedAt };
}
