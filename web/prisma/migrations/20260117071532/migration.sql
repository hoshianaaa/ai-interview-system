/*
  Warnings:

  - You are about to drop the column `isDefault` on the `PromptTemplate` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "OrgSetting" ADD COLUMN     "candidateEmailTemplate" TEXT;

-- AlterTable
ALTER TABLE "PromptTemplate" DROP COLUMN "isDefault";

-- AlterTable
ALTER TABLE "SystemSetting" ADD COLUMN     "candidateEmailTemplate" TEXT;
