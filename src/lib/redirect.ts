export function safeLocalRedirect(value: string, fallback: string) {
  const target = value.trim();
  if (
    !target
    || target.length > 2048
    || !target.startsWith("/")
    || target.startsWith("//")
    || /[\\\u0000-\u001f\u007f]/.test(target)
    || /%5c/i.test(target)
  ) return fallback;
  return target;
}
