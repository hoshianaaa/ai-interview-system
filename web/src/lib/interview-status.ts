import { InterviewStatus } from "@prisma/client";

export type ProgressStatus = "scheduled" | "completed" | "noShow" | "failed";

const PROGRESS_STATUS_LABELS: Record<ProgressStatus, string> = {
  scheduled: "実施待ち",
  completed: "完了",
  noShow: "未参加",
  failed: "失敗（エラー）"
};

export function isInterviewExpired(
  expiresAt: Date | null | undefined,
  now: Date = new Date()
): boolean {
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
}

export function getProgressStatus(
  input: {
    status: InterviewStatus;
    expiresAt: Date | null;
    usedAt: Date | null;
  },
  now: Date = new Date()
): ProgressStatus {
  if (input.status === "failed") return "failed";
  if (input.status === "completed") return "completed";
  if (isInterviewExpired(input.expiresAt, now) && !input.usedAt) return "noShow";
  return "scheduled";
}

export function getProgressStatusLabel(
  input: {
    status: InterviewStatus;
    expiresAt: Date | null;
    usedAt: Date | null;
  },
  now: Date = new Date()
): string {
  return PROGRESS_STATUS_LABELS[getProgressStatus(input, now)];
}
