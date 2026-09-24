/** Next's dev bind address can differ from the loopback Host used by the browser. */
export function isLocalSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!origin || !host) return false;
  try {
    const browser = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(browser.hostname)
      && ["http:", "https:"].includes(browser.protocol)
      && browser.origin === `${new URL(request.url).protocol}//${host}`;
  } catch { return false; }
}
