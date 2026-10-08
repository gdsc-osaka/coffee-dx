const STAFF_PATH_PREFIXES = ["/order", "/drip", "/drip2", "/cashier"];

export function isStaffPath(pathname: string): boolean {
  return STAFF_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function safeStaffReturnTo(value: string | null | undefined): string {
  const hasControlCharacter =
    value &&
    [...value].some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    });
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("#") ||
    hasControlCharacter
  ) {
    return "/order";
  }

  try {
    const url = new URL(value, "https://auth.invalid");
    if (url.origin !== "https://auth.invalid" || !isStaffPath(url.pathname)) return "/order";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/order";
  }
}

export function staffReturnToFromRequest(request: Request): string {
  const url = new URL(request.url);
  return safeStaffReturnTo(`${url.pathname}${url.search}`);
}
