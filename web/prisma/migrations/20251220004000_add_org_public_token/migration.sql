-- Add organization and public token for multi-tenant separation
ALTER TABLE "Interview"
  ADD COLUMN "publicToken" TEXT,
  ADD COLUMN "orgId" TEXT;

-- Ensure public tokens are unique when present
CREATE UNIQUE INDEX "Interview_publicToken_key" ON "Interview"("publicToken");

-- Enable fast organization scoping
CREATE INDEX "Interview_orgId_idx" ON "Interview"("orgId");
