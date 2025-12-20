-- Add prompt templates (per org)
CREATE TABLE "PromptTemplate" (
    "templateId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("templateId")
);

CREATE INDEX "PromptTemplate_orgId_idx" ON "PromptTemplate"("orgId");

CREATE UNIQUE INDEX "PromptTemplate_orgId_name_key" ON "PromptTemplate"("orgId", "name");
