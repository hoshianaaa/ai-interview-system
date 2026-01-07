import type { Prisma } from "@prisma/client";

export const SYSTEM_SETTINGS_ID = 1;
export const DEFAULT_MAX_CONCURRENT_INTERVIEWS = 5;

type SystemSettingsClient = Pick<Prisma.TransactionClient, "systemSetting">;

export const getSystemMaxConcurrentInterviews = async (
  client: SystemSettingsClient
): Promise<number> => {
  const settings = await client.systemSetting.findUnique({
    where: { id: SYSTEM_SETTINGS_ID }
  });
  return settings?.maxConcurrentInterviews ?? DEFAULT_MAX_CONCURRENT_INTERVIEWS;
};
