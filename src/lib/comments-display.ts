import { shanghaiParts } from "./datetime";

// 评论时间格式（统一上海时区）：今天 HH:MM；今年 MM-DD HH:MM；更早 YYYY-MM-DD
export function formatCommentTime(value: string): string {
  const p = shanghaiParts(value);
  if (!p) return "";
  const now = shanghaiParts(new Date());
  if (!now) return `${p.year}-${p.month}-${p.day}`;
  if (p.year === now.year && p.month === now.month && p.day === now.day) {
    return `${p.hour}:${p.minute}`;
  }
  if (p.year === now.year) {
    return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
  }
  return `${p.year}-${p.month}-${p.day}`;
}
