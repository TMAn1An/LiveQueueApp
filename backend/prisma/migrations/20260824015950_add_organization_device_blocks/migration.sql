-- CreateTable
CREATE TABLE "organization_device_blocks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_device_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_device_blocks_organization_id_device_id_key" ON "organization_device_blocks"("organization_id", "device_id");

-- AddForeignKey
ALTER TABLE "organization_device_blocks" ADD CONSTRAINT "organization_device_blocks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_device_blocks" ADD CONSTRAINT "organization_device_blocks_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
