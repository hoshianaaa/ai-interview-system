import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
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
  agentName: mustEnv("LIVEKIT_AGENT_NAME")
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
    dispatch: new AgentDispatchClient(env.livekitUrl, env.livekitApiKey, env.livekitApiSecret),
    webhook: new WebhookReceiver(env.livekitApiKey, env.livekitApiSecret)
  };
}
