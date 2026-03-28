import { execSync } from "node:child_process";

let cachedHostname: string | null = null;

function resolveHostname(): string {
  let rawJson: string;
  try {
    rawJson = execSync("tailscale status --json", { encoding: "utf8" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to run tailscale status --json: ${detail}`);
  }

  let parsed: { Self?: { DNSName?: string } };
  try {
    parsed = JSON.parse(rawJson) as { Self?: { DNSName?: string } };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse tailscale status --json output: ${detail}`);
  }

  const dnsName = parsed.Self?.DNSName;
  if (!dnsName) {
    throw new Error("Tailscale DNSName missing in tailscale status --json output");
  }

  const cleaned = dnsName.endsWith(".") ? dnsName.slice(0, -1) : dnsName;
  if (!cleaned) {
    throw new Error("Resolved Tailscale DNSName is empty");
  }

  return cleaned;
}

export function getTailscaleHostname(): string {
  if (!cachedHostname) {
    cachedHostname = resolveHostname();
  }

  return cachedHostname;
}
