export function utcTimestampCompact(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

export function makeR2ObjectKey(params: {
  interviewId: string;
  roomName: string;
  startedAt?: Date;
  orgId?: string | null;
}) {
  const ts = utcTimestampCompact(params.startedAt ?? new Date());
  const orgSegment = params.orgId ? params.orgId.replace(/[^a-zA-Z0-9_-]/g, "_") : "unassigned";
  return `recordings/orgs/${orgSegment}/${params.interviewId}/${ts}_${params.roomName}.mp4`;
}
