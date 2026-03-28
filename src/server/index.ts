import express from "express";
import type { Request, Response, NextFunction } from "express";
import { getTailscaleHostname } from "./tailscale";
import { tailscaleOnly } from "./network";

const PORT = 7979;
const HOST = "0.0.0.0";
const VERSION = "0.1.0";

function getMode(): string {
  if (
    process.env.NODE_ENV === "development" ||
    process.argv.includes("--dev") ||
    process.argv.includes("--mode=dev")
  ) {
    return "development";
  }
  return "production";
}

function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
}

const app = express();
app.use(express.json());
app.use(requestLogger);
app.use(tailscaleOnly);

const tailscaleHost = getTailscaleHostname();
const mode = getMode();

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    tailscaleHost,
    docCount: 0,
    uptime: process.uptime()
  });
});

const server = app.listen(PORT, HOST, () => {
  const url = `http://${tailscaleHost}:${PORT}`;
  console.log("");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║           plan-present                   ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`  Version : ${VERSION}`);
  console.log(`  Port    : ${PORT}`);
  console.log(`  Mode    : ${mode}`);
  console.log(`  URL     : ${url}`);
  console.log("");
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Exiting.`);
    process.exit(1);
  }

  throw error;
});
