const rtf = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });

export function relativeTime(date: Date | null, now: Date = new Date()): string {
  if (!date) return "sin mensajes";
  const s = Math.round((now.getTime() - date.getTime()) / 1000);
  if (s < 60) return "recién";
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
  return rtf.format(-Math.floor(s / 86400), "day");
}
