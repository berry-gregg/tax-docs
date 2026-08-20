/**
 * Test-wide network guard. Tests must never reach a real server: server tests go through
 * `app.request()` in-process, client tests stub `globalThis.fetch` per case. An unstubbed
 * fetch here would silently hit whatever is listening (e.g. a running dev server on :3000)
 * and mutate its data, so it fails loudly instead.
 */
globalThis.fetch = ((input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(
    `Unstubbed fetch in a test: ${url}. Stub globalThis.fetch (client tests) or use app.request() (server tests).`,
  );
}) as unknown as typeof fetch;
