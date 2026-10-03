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
  const staff = await staffService.createStaff(req.auth!, req.body);
  res.status(201).json({ success: true, data: staff });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'staff_created',
    entityType: 'staff',
    entityId: staff.id,
    // Conservative on purpose: role indicates seniority without duplicating
    // the full permissions array in a second, easily-stale place.
    metadata: { email: staff.email, role: staff.role, workspaceAdminId: staff.workspaceAdminId },
    workspaceAdminId: staff.role === 'STAFF' ? staff.workspaceAdminId : null,
    ipAddress: req.ip,
  });
}

export async function get(req: Request, res: Response) {
  const staff = await staffService.getStaff(req.auth!, req.params.staffId as string);
  res.status(200).json({ success: true, data: staff });
}

export async function update(req: Request, res: Response) {
  const staff = await staffService.updateStaff(
    req.auth!,
    req.params.staffId as string,
    req.body,
    { staffId: req.auth!.staffId, role: req.auth!.role },
  );
  res.status(200).json({ success: true, data: staff });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'staff_updated',
    entityType: 'staff',
    entityId: staff.id,
    // Field names only, never values — req.body may include a new
    // `password`, whose value must never be recorded (only that it changed).
    metadata: { changedFields: Object.keys(req.body as object) },
    ipAddress: req.ip,
  });
}

function membershipActor(req: Request): membershipService.MembershipActor {
  return {
    staffId: req.auth!.staffId,
    organizationId: req.auth!.organizationId,
    role: req.auth!.role,
  };
}

/** ADR-057: direct removal, under the owner/admin matrix. */
export async function remove(req: Request, res: Response) {
  const removed = await membershipService.removeMember(
    membershipActor(req),
    req.params.staffId as string,
  );
  res.status(204).send();
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'staff_removed',
    entityType: 'staff',
    entityId: removed.id,
    metadata: { email: removed.email, role: removed.role },
    ipAddress: req.ip,
  });
  realtime.disconnectStaff(removed.id);
}

export async function listRemovalRequests(req: Request, res: Response) {
  const { status } = req.query as { status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' };
  const data = await membershipService.listRemovalRequests(membershipActor(req), status);
  res.status(200).json({ success: true, data });
}

export async function createRemovalRequest(req: Request, res: Response) {
  const request = await membershipService.createRemovalRequest(membershipActor(req), req.body);
  res.status(201).json({ success: true, data: request });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'membership_request_created',
    entityType: 'membership_removal_request',
    entityId: request.id,
    metadata: { requestType: request.requestType, targetStaffId: request.target.id },
    ipAddress: req.ip,
  });
}

export async function approveRemovalRequest(req: Request, res: Response) {
  const result = await membershipService.approveRemovalRequest(
    membershipActor(req),
    req.params.requestId as string,
    req.body.reviewNote,
  );
  res.status(200).json({ success: true, data: result.request });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'membership_request_approved',
    entityType: 'membership_removal_request',
    entityId: result.request.id,
    metadata: {
      requestType: result.request.requestType,
      targetStaffId: result.request.target.id,
      outcome: result.request.status,
    },
    ipAddress: req.ip,
  });
  if (result.removed) {
    await auditService.recordAuditEventSafely({
      actor: auditService.actorFromAuth(req.auth!),
      action: 'staff_removed',
      entityType: 'staff',
      entityId: result.removed.id,
      metadata: {
        email: result.removed.email,
        role: result.removed.role,
        removalRequestId: result.request.id,
      },
      ipAddress: req.ip,
    });
    realtime.disconnectStaff(result.removed.id);
  }
}

export async function rejectRemovalRequest(req: Request, res: Response) {
  const request = await membershipService.rejectRemovalRequest(
    membershipActor(req),
    req.params.requestId as string,
    req.body.reviewNote,
  );
  res.status(200).json({ success: true, data: request });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'membership_request_rejected',
    entityType: 'membership_removal_request',
    entityId: request.id,
    metadata: { requestType: request.requestType, targetStaffId: request.target.id },
    ipAddress: req.ip,
  });
}

export async function cancelRemovalRequest(req: Request, res: Response) {
  const request = await membershipService.cancelRemovalRequest(
    membershipActor(req),
    req.params.requestId as string,
  );
  res.status(200).json({ success: true, data: request });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'membership_request_cancelled',
    entityType: 'membership_removal_request',
    entityId: request.id,
    metadata: { requestType: request.requestType },
    ipAddress: req.ip,
  });
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
  );
  res.status(200).json({ success: true, data: staff });
  await auditService.recordAuditEventSafely({
    actor: auditService.actorFromAuth(req.auth!),
    action: 'staff_updated',
    entityType: 'staff',
    entityId: staff.id,
    metadata: { changedFields: ['workspaceAdminId'], workspaceAdminId: staff.workspaceAdminId },
    workspaceAdminId: staff.workspaceAdminId,
    ipAddress: req.ip,
  });
  realtime.disconnectStaff(staff.id);
}
