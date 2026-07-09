export function safeLocalRedirect(value: string, fallback: string) {
  const target = value.trim();
  if (!target || !target.startsWith("/") || target.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(target)) return fallback;
  if (/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(target)) return fallback;

  try {
    const url = new URL(target, "https://local.invalid");
    if (url.origin !== "https://local.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
