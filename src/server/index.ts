import express from "express";
import { getTailscaleHostname } from "./tailscale";
import { tailscaleOnly } from "./network";

const PORT = 7979;
const HOST = "0.0.0.0";

const app = express();
app.use(express.json());
app.use(tailscaleOnly);

const tailscaleHost = getTailscaleHostname();

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    tailscaleHost,
    docCount: 0,
    uptime: process.uptime()
  });
});

const server = app.listen(PORT, HOST, () => {
  console.log("plan-present listening on port 7979");
  console.log(`Tailscale URL: http://${tailscaleHost}:7979`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Exiting.`);
    process.exit(1);
  }

  throw error;
});
