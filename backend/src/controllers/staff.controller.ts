import type { Request, Response } from 'express';
import * as staffService from '../services/staff.service';
import * as auditService from '../services/audit.service';
import * as membershipService from '../services/membership.service';
import * as realtime from '../realtime/emit';

export async function list(req: Request, res: Response) {
  const { page, pageSize, search, adminId } = req.query as unknown as {
    page: number;
    pageSize: number;
    search?: string;
    adminId?: string;
  };
  const result = await staffService.listStaff(req.auth!, page, pageSize, search, adminId);
  res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
}

export async function create(req: Request, res: Response) {
  // ADR-071: the account and its staff_created audit row commit together.
  const staff = await staffService.createStaff(req.auth!, req.body, req.ip);
  res.status(201).json({ success: true, data: staff });
}

export async function get(req: Request, res: Response) {
  const staff = await staffService.getStaff(req.auth!, req.params.staffId as string);
  res.status(200).json({ success: true, data: staff });
}

export async function update(req: Request, res: Response) {
  // ADR-071: the change and its audit row (with before/after values) commit
  // together inside the service.
  const result = await staffService.updateStaff(req.auth!, req.params.staffId as string, req.body, req.ip);
  res.status(200).json({ success: true, data: result.staff });
  // A new role, a suspension or ended sessions change which rooms this
  // person may hear: their open sockets are closed so they reconnect with
  // their current authority.
  if (result.authorizationChanged) realtime.disconnectStaff(result.staff.id);
}

function membershipActor(req: Request): membershipService.MembershipActor {
  return {
    staffId: req.auth!.staffId,
    organizationId: req.auth!.organizationId,
    role: req.auth!.role,
    email: req.auth!.email,
    workspaceAdminId: req.auth!.workspaceAdminId,
  };
}

/** ADR-057: direct removal, under the owner/admin matrix. ADR-071: the
 * removal and its audit row commit together. */
export async function remove(req: Request, res: Response) {
  const removed = await membershipService.removeMember(membershipActor(req), req.params.staffId as string, req.ip);
  res.status(204).send();
  realtime.disconnectStaff(removed.id);
}

export async function listRemovalRequests(req: Request, res: Response) {
  const { status } = req.query as { status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' };
  const data = await membershipService.listRemovalRequests(membershipActor(req), status);
  res.status(200).json({ success: true, data });
}

export async function createRemovalRequest(req: Request, res: Response) {
  const request = await membershipService.createRemovalRequest(membershipActor(req), req.body, req.ip);
  res.status(201).json({ success: true, data: request });
}

export async function approveRemovalRequest(req: Request, res: Response) {
  const result = await membershipService.approveRemovalRequest(
    membershipActor(req),
    req.params.requestId as string,
    req.body.reviewNote,
    req.ip,
  );
  res.status(200).json({ success: true, data: result.request });
  if (result.removed) realtime.disconnectStaff(result.removed.id);
}

export async function rejectRemovalRequest(req: Request, res: Response) {
  const request = await membershipService.rejectRemovalRequest(
    membershipActor(req),
    req.params.requestId as string,
    req.body.reviewNote,
    req.ip,
  );
  res.status(200).json({ success: true, data: request });
}

export async function cancelRemovalRequest(req: Request, res: Response) {
  const request = await membershipService.cancelRemovalRequest(
    membershipActor(req),
    req.params.requestId as string,
    req.ip,
  );
  res.status(200).json({ success: true, data: request });
}

/**
 * ADR-035: re-issues an invitation for someone who has not set up their
 * account yet. Rate-limited at the route and cooled down in the service, so
 * an impatient click cannot turn into a stream of provider requests.
 */
export async function resendInvitation(req: Request, res: Response) {
  const result = await staffService.resendStaffInvitation(
    req.auth!.organizationId,
    req.params.staffId as string,
  );
  res.status(200).json({ success: true, data: result });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'staff_updated',
    entityType: 'staff',
    entityId: req.params.staffId as string,
    // Whether it actually reached the provider is the operationally useful
    // fact; the token and the link never appear anywhere.
    metadata: { invitationResent: true, emailSent: result.emailSent },
    ipAddress: req.ip,
  });
}

/** ADR-069 D3: the Organization Head moves an Executive between workspaces. */
export async function setWorkspace(req: Request, res: Response) {
  const staff = await staffService.setExecutiveWorkspace(
    req.auth!,
    req.params.staffId as string,
    req.body.adminId,
    req.ip,
  );
  res.status(200).json({ success: true, data: staff });
  realtime.disconnectStaff(staff.id);
}
