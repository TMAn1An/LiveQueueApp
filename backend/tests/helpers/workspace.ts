import { api, createStaffWithRole, registerOwner, type RegisteredContext, type RestrictedStaffContext } from './app';

/**
 * ADR-069/070 fixtures: an organization with its Head, Admins that each run
 * one queue (created through the real atomic endpoint), Executives in an
 * Admin's workspace operating counters, and the serving actions they take.
 */

export function as(accessToken: string) {
  const auth = (r: ReturnType<ReturnType<typeof api>['get']>) => r.set('Authorization', `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(api().get(path)),
    post: (path: string, body: object = {}) => auth(api().post(path)).send(body),
    put: (path: string, body: object = {}) => auth(api().put(path)).send(body),
    patch: (path: string, body: object = {}) => auth(api().patch(path)).send(body),
    delete: (path: string, body: object = {}) => auth(api().delete(path)).send(body),
  };
}

export interface Workspace {
  head: RegisteredContext;
  admin: RestrictedStaffContext;
  queueId: string;
  /** The first counter, created with the queue and operated by the Admin. */
  firstCounterId: string;
}

let orgCounter = 0;

export async function headOrganization(): Promise<RegisteredContext> {
  orgCounter += 1;
  return registerOwner({ organizationName: `Workspace Org ${orgCounter} ${Math.random().toString(36).slice(2, 6)}` });
}

/** An Admin of `head`'s organization with their own queue (and its first,
 * Admin-operated counter). */
export async function adminWorkspace(
  head?: RegisteredContext,
  queue: Record<string, unknown> = {},
): Promise<Workspace> {
  const owner = head ?? (await headOrganization());
  const admin = await createStaffWithRole(owner.organizationId, 'ADMIN');
  const res = await as(admin.accessToken).post('/api/queues', {
    name: `Queue ${Math.random().toString(36).slice(2, 7)}`,
    ...queue,
  });
  if (res.status !== 201) throw new Error(`adminWorkspace queue: ${res.status} ${JSON.stringify(res.body)}`);
  const counters = await as(admin.accessToken).get(`/api/queues/${res.body.data.id}/counters`);
  return { head: owner, admin, queueId: res.body.data.id, firstCounterId: counters.body.data[0].id };
}

export async function addService(
  token: string,
  queueId: string,
  serviceName: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await as(token).post(`/api/queues/${queueId}/services`, { serviceName, durationMinutes: 5, ...extra });
  if (res.status !== 201) throw new Error(`addService: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id;
}

export async function executiveOf(ws: Pick<Workspace, 'head' | 'admin'>): Promise<RestrictedStaffContext> {
  return createStaffWithRole(ws.head.organizationId, 'STAFF', { workspaceAdminId: ws.admin.staffId });
}

/** A new active counter of the workspace's queue, operated by a new
 * Executive, optionally limited to some services. */
export async function executiveCounter(
  ws: Workspace,
  name: string,
  serviceIds: string[] = [],
): Promise<{ counterId: string; operator: RestrictedStaffContext }> {
  const operator = await executiveOf(ws);
  const res = await as(ws.admin.accessToken).post(`/api/queues/${ws.queueId}/counters`, {
    name,
    operatorStaffId: operator.staffId,
  });
  if (res.status !== 201) throw new Error(`executiveCounter: ${res.status} ${JSON.stringify(res.body)}`);
  if (serviceIds.length > 0) {
    const routed = await as(ws.admin.accessToken).put(`/api/counters/${res.body.data.id}/services`, { serviceIds });
    if (routed.status !== 200) throw new Error(`routing: ${routed.status} ${JSON.stringify(routed.body)}`);
  }
  return { counterId: res.body.data.id, operator };
}

export async function routeCounter(token: string, counterId: string, serviceIds: string[]) {
  const res = await as(token).put(`/api/counters/${counterId}/services`, { serviceIds });
  if (res.status !== 200) throw new Error(`routeCounter: ${res.status} ${JSON.stringify(res.body)}`);
}

export async function join(queueId: string, serviceIds: string[]) {
  const deviceIdentifier = `device-${Math.random().toString(36).slice(2, 10)}`;
  const res = await api()
    .post('/api/tokens')
    .set('Idempotency-Key', `idem-${Math.random().toString(36).slice(2, 10)}`)
    .send({ queueId, serviceIds, deviceIdentifier, formData: {} });
  if (res.status !== 201) throw new Error(`join: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.data.id as string, deviceIdentifier, body: res.body.data };
}

export async function serveNext(token: string, queueId: string) {
  return as(token).post(`/api/queues/${queueId}/next`, {});
}

/** Serve next, then start: the operator's counter now serves that person. */
export async function callAndStart(token: string, queueId: string): Promise<string> {
  const called = await serveNext(token, queueId);
  if (called.status !== 200) throw new Error(`serveNext: ${called.status} ${JSON.stringify(called.body)}`);
  const started = await as(token).post(`/api/tokens/${called.body.data.id}/start`, {});
  if (started.status !== 200) throw new Error(`start: ${started.status} ${JSON.stringify(started.body)}`);
  return called.body.data.id;
}

export function complete(token: string, tokenId: string, body: Record<string, unknown> = {}) {
  return as(token).post(`/api/tokens/${tokenId}/complete`, body);
}
