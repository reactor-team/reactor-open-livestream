type TimestampOptions = { locale?: string; timeZone?: string };

export function formatChatTimestamp(createdAt: number, { locale, timeZone }: TimestampOptions = {}) {
  if (!Number.isFinite(createdAt)) return null;
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return null;

  return {
    dateTime: date.toISOString(),
    label: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(date),
    fullLabel: new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "long", timeZone }).format(date),
  };
}
