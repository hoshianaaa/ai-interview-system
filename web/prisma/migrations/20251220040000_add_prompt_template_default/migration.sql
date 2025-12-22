-- Add default flag for prompt templates
ALTER TABLE "PromptTemplate" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
