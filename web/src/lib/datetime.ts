const DATE_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

const parseDate = (value: Date | string | number) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDateJst = (value: Date | string | number | null | undefined) => {
  if (value == null) return "";
  const date = parseDate(value);
  if (!date) return "";
  return DATE_FORMATTER.format(date);
};

export const formatDateTimeJst = (value: Date | string | number | null | undefined) => {
  if (value == null) return "";
  const date = parseDate(value);
  if (!date) return "";
  return DATE_TIME_FORMATTER.format(date);
};
