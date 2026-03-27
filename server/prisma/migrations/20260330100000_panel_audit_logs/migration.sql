-- Portal (admin + merchant UI) mutation audit trail — separate from gateway/callback audit_logs.

CREATE TABLE "panel_audit_logs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "panel" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "target_merchant_id" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "http_status" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,

    CONSTRAINT "panel_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "panel_audit_logs_created_at_idx" ON "panel_audit_logs"("created_at");
CREATE INDEX "panel_audit_logs_panel_idx" ON "panel_audit_logs"("panel");
CREATE INDEX "panel_audit_logs_actor_id_idx" ON "panel_audit_logs"("actor_id");
CREATE INDEX "panel_audit_logs_target_merchant_id_idx" ON "panel_audit_logs"("target_merchant_id");
