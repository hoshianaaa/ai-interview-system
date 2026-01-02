import crypto from "crypto";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const streamEnv = {
  accountId: mustEnv("CLOUDFLARE_ACCOUNT_ID"),
  apiToken: mustEnv("CLOUDFLARE_STREAM_API_TOKEN"),
  playbackBaseUrl: (process.env.CLOUDFLARE_STREAM_PLAYBACK_BASE_URL ?? "https://videodelivery.net")
    .replace(/\/$/, ""),
  signingKeyId: process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID ?? "",
  signingKey: process.env.CLOUDFLARE_STREAM_SIGNING_KEY ?? ""
};

type DirectUploadResult = {
  uid: string;
  uploadURL: string;
};

export async function createStreamDirectUpload(params: {
  metadata?: Record<string, string>;
  maxDurationSeconds?: number;
}) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${streamEnv.accountId}/stream/direct_upload`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${streamEnv.apiToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        maxDurationSeconds: params.maxDurationSeconds ?? 3600,
        meta: params.metadata ?? {}
      })
    }
  );
  const data = (await res.json().catch(() => null)) as
    | { success: boolean; result?: DirectUploadResult; errors?: { message?: string }[] }
    | null;
  if (!res.ok || !data?.success || !data.result?.uploadURL) {
    const message =
      data?.errors?.map((err) => err?.message).filter(Boolean).join(", ") ||
      `Cloudflare Stream upload init failed (${res.status})`;
    throw new Error(message);
  }
  return data.result;
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signPlaybackToken(uid: string, expiresInSeconds: number) {
  if (!streamEnv.signingKey || !streamEnv.signingKeyId) return null;
  const header = { alg: "HS256", typ: "JWT", kid: streamEnv.signingKeyId };
  const payload = {
    sub: uid,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  };
  const headerPart = base64Url(JSON.stringify(header));
  const payloadPart = base64Url(JSON.stringify(payload));
  const data = `${headerPart}.${payloadPart}`;
  const signature = crypto
    .createHmac("sha256", streamEnv.signingKey)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${data}.${signature}`;
}

export function buildStreamPlaybackUrl(uid: string, expiresInSeconds = 3600) {
  const base = `${streamEnv.playbackBaseUrl}/${uid}/manifest/video.m3u8`;
  const token = signPlaybackToken(uid, expiresInSeconds);
  return token ? `${base}?token=${token}` : base;
}
