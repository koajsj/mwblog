export function safeLocalRedirect(value: string, fallback: string) {
  const target = value.trim();
  if (!target || !target.startsWith("/") || target.startsWith("//")) return fallback;
  return target;
}
