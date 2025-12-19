import {
  AccessToken,
  AgentDispatchClient,
  EgressClient,
  EncodedFileOutput,
  EncodingOptionsPreset,
  RoomServiceClient,
  S3Upload,
  WebhookReceiver,
  type VideoGrant
} from "livekit-server-sdk";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const env = {
  baseUrl: mustEnv("NEXT_PUBLIC_BASE_URL"),

  livekitUrl: mustEnv("LIVEKIT_URL"),
  livekitApiKey: mustEnv("LIVEKIT_API_KEY"),
  livekitApiSecret: mustEnv("LIVEKIT_API_SECRET"),
  agentName: mustEnv("LIVEKIT_AGENT_NAME"),

  r2AccountId: mustEnv("R2_ACCOUNT_ID"),
  r2Bucket: mustEnv("R2_BUCKET"),
  r2AccessKeyId: mustEnv("R2_ACCESS_KEY_ID"),
  r2SecretAccessKey: mustEnv("R2_SECRET_ACCESS_KEY"),
  r2Endpoint: process.env.R2_ENDPOINT ?? `https://${mustEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`
};

export function makeRoomName(interviewId: string) {
  return `ivw_${interviewId}`;
}

export function makeCandidateIdentity(interviewId: string) {
  return `candidate_${interviewId}`;
}

export async function makeCandidateToken(params: {
  roomName: string;
  identity: string;
  ttlSeconds: number;
}) {
  const at = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
    identity: params.identity,
    ttl: params.ttlSeconds
  });

  const grant: VideoGrant = {
    room: params.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  };

  at.addGrant(grant);
  return await at.toJwt();
}

export function clients() {
  return {
    room: new RoomServiceClient(env.livekitUrl, env.livekitApiKey, env.livekitApiSecret),
    egress: new EgressClient(env.livekitUrl, env.livekitApiKey, env.livekitApiSecret),
    dispatch: new AgentDispatchClient(env.livekitUrl, env.livekitApiKey, env.livekitApiSecret),
    webhook: new WebhookReceiver(env.livekitApiKey, env.livekitApiSecret)
  };
}

// Cloudflare R2 (S3 compatible)
export function buildR2S3Upload(): S3Upload {
  return new S3Upload({
    accessKey: env.r2AccessKeyId,
    secret: env.r2SecretAccessKey,
    region: "auto",
    bucket: env.r2Bucket,
    endpoint: env.r2Endpoint,
    forcePathStyle: true
  });
}

export function buildRoomCompositeOutput(objectKey: string): EncodedFileOutput {
  return new EncodedFileOutput({
    filepath: objectKey,
    output: { case: "s3", value: buildR2S3Upload() }
  });
}

export const defaultCompositeOpts = {
  layout: "speaker",
  encodingOptions: EncodingOptionsPreset.H264_720P_30
};
