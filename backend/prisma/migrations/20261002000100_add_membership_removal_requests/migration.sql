-- ADR-057: owner-reviewed requests to end a membership (self leave, or an
-- admin asking the owner to remove another admin). Purely additive: two new
-- enum types and one new table. No existing row is read or changed.

-- CreateEnum
CREATE TYPE "MembershipRequestType" AS ENUM ('SELF_LEAVE', 'ADMIN_REMOVAL_REQUEST');

-- CreateEnum
CREATE TYPE "MembershipRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "membership_removal_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "request_type" "MembershipRequestType" NOT NULL,
    "status" "MembershipRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requester_id" TEXT NOT NULL,
    "requester_name" TEXT NOT NULL,
    "requester_email" TEXT NOT NULL,
    "target_staff_id" TEXT NOT NULL,
    "target_name" TEXT NOT NULL,
    "target_email" TEXT NOT NULL,
    "target_role" "StaffRole" NOT NULL,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "reviewed_by_name" TEXT,
    "review_note" TEXT,
    "active_slot" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_removal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membership_removal_requests_organization_id_status_created__idx" ON "membership_removal_requests"("organization_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "membership_removal_requests_target_staff_id_request_type_ac_key" ON "membership_removal_requests"("target_staff_id", "request_type", "active_slot");

-- AddForeignKey
ALTER TABLE "membership_removal_requests" ADD CONSTRAINT "membership_removal_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

