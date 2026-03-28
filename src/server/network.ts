import type { NextFunction, Request, Response } from "express";

const CGNAT_MIN = ipToNumber("100.64.0.0");
const CGNAT_MAX = ipToNumber("100.127.255.255");

function isDevMode(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.argv.includes("--dev") ||
    process.argv.includes("--mode=dev")
  );
}

function normalizeRemoteAddress(address: string | undefined): string | null {
  if (!address) {
    return null;
  }

  if (address.startsWith("::ffff:")) {
    return address.slice(7);
  }

  return address;
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((num) => Number.isNaN(num) || num < 0 || num > 255)) {
    return null;
  }

  return (
    (numbers[0] << 24) +
    (numbers[1] << 16) +
    (numbers[2] << 8) +
    numbers[3]
  ) >>> 0;
}

function isTailscaleAddress(address: string | null): boolean {
  if (!address) {
    return false;
  }

  if (address === "127.0.0.1" || address === "::1") {
    return true;
  }

  const numeric = ipToNumber(address);
  if (numeric === null) {
    return false;
  }

  return numeric >= (CGNAT_MIN ?? 0) && numeric <= (CGNAT_MAX ?? 0);
}

export function tailscaleOnly(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (isDevMode()) {
    next();
    return;
  }

  const remote = normalizeRemoteAddress(req.socket.remoteAddress);
  if (!isTailscaleAddress(remote)) {
    res.status(403).json({
      ok: false,
      error: "forbidden",
      message: "Tailscale-only access"
    });
    return;
  }

  next();
}
