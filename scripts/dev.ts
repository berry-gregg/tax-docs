import { config } from "../src/server/config.ts";

const HEALTH_URL = `http://127.0.0.1:${config.port}/api/health`;
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 250;

const server = Bun.spawn(["bun", "--watch", "src/server/index.ts"], {
  stdout: "inherit",
  stderr: "inherit",
});

/**
 * Vite proxies /api to the Hono server; starting both at once floods the terminal with
 * ECONNREFUSED proxy errors while the API connects Mongo and seeds. Wait for the health
 * endpoint before bringing Vite up.
 */
async function waitForApi(): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.killed) {
      return;
    }
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) {
        return;
      }
    } catch {
      // API not listening yet — keep polling.
    }
    await Bun.sleep(HEALTH_POLL_MS);
  }
  console.error(`API did not become healthy at ${HEALTH_URL} within ${HEALTH_TIMEOUT_MS}ms; starting Vite anyway.`);
}

await waitForApi();

const client = Bun.spawn(["bunx", "vite"], {
  stdout: "inherit",
  stderr: "inherit",
});

function shutdown() {
  server.kill();
  client.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.all([server.exited, client.exited]);
