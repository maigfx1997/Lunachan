#!/usr/bin/env node
/**
 * Luna Chan launcher for free Node hosting panels (aeonfree / aeon / Pterodactyl
 * style dashboards). The panel hands out a port through PORT or SERVER_PORT, so
 * we detect it and pass it to `next start`.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");

const port =
  process.env.PORT ||
  process.env.SERVER_PORT ||
  process.env.APP_PORT ||
  process.env.NODE_PORT ||
  "3000";

const hostname = process.env.HOSTNAME_BIND || "0.0.0.0";

console.log(`🌙 Luna Chan starting on ${hostname}:${port}`);

const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", hostname], {
  stdio: "inherit",
  env: { ...process.env, PORT: String(port) },
});

child.on("exit", (code) => {
  console.log(`Luna Chan stopped with code ${code}`);
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
