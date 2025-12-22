-- Move interview notes to application notes
ALTER TABLE "Application" ADD COLUMN "applicationNotes" TEXT;

UPDATE "Application" AS a
SET "applicationNotes" = s."interviewNotes"
FROM (
  SELECT DISTINCT ON (i."applicationId")
    i."applicationId",
    i."interviewNotes"
  FROM "Interview" i
  WHERE i."interviewNotes" IS NOT NULL
  ORDER BY i."applicationId", i."createdAt" DESC
) AS s
WHERE a."applicationId" = s."applicationId";

ALTER TABLE "Interview" DROP COLUMN "interviewNotes";
