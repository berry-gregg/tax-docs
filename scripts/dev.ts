export {};

const server = Bun.spawn(["bun", "--watch", "src/server/index.ts"], {
  stdout: "inherit",
  stderr: "inherit",
});

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
