// 把任意 ISO/Date 转成上海时区的各组成部分，避免在 SSR (UTC) 与浏览器（本地）之间漂移。
export type ShanghaiParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

const FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function shanghaiParts(value: string | Date): ShanghaiParts | null {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  const parts = FORMATTER.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const hourRaw = get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: hourRaw === "24" ? "00" : hourRaw,
    minute: get("minute"),
  };
}

export function shanghaiDateKey(value: string | Date = new Date()) {
  const parts = shanghaiParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

export function isDateKey(value: string) {
  const hit = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!hit) return false;
  const year = Number(hit[1]);
  const month = Number(hit[2]);
  const day = Number(hit[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
