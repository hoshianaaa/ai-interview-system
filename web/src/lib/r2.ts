import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/livekit";

const r2Client = new S3Client({
  region: "auto",
  endpoint: env.r2Endpoint,
  credentials: {
    accessKeyId: env.r2AccessKeyId,
    secretAccessKey: env.r2SecretAccessKey
  },
  forcePathStyle: true
});

export async function signR2ObjectUrl(objectKey: string, expiresInSeconds = 3600) {
  const command = new GetObjectCommand({
    Bucket: env.r2Bucket,
    Key: objectKey
  });
  return await getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds });
}
