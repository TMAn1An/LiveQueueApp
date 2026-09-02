-- CreateTable
CREATE TABLE "token_services" (
    "token_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_services_pkey" PRIMARY KEY ("token_id","service_id")
);

-- CreateIndex
CREATE INDEX "token_services_service_id_idx" ON "token_services"("service_id");

-- AddForeignKey
ALTER TABLE "token_services" ADD CONSTRAINT "token_services_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_services" ADD CONSTRAINT "token_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "queue_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill (V2 Checkpoint 5, ADR-027): every existing token's single
-- service_id becomes its one TokenService row, preserving each token's
-- created_at as the join row's own created_at. tokens.service_id itself is
-- left completely untouched by this migration — it remains the legacy
-- "primary service" column, still populated on every future insert too, so
-- no historical or in-flight data becomes unreadable and no code path that
-- still reads Token.serviceId directly (including an old, not-yet-updated
-- mobile client) is affected.
INSERT INTO "token_services" ("token_id", "service_id", "created_at")
SELECT "id", "service_id", "created_at" FROM "tokens";
