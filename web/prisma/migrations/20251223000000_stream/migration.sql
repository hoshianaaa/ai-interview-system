ALTER TABLE "Interview" DROP COLUMN "egressId";
ALTER TABLE "Interview" DROP COLUMN "r2Bucket";
ALTER TABLE "Interview" DROP COLUMN "r2ObjectKey";
ALTER TABLE "Interview" ADD COLUMN "streamUid" TEXT;
