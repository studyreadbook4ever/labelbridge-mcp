import { rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";

export interface AppConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  publicBaseUrlExplicit: boolean;
  dataDir: string;
  databasePath: string;
  serverSecret: Buffer;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "3000");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

function loadOrCreateSecret(dataDir: string): Buffer {
  const envSecret = process.env.LABELBRIDGE_SECRET;
  if (envSecret && envSecret.length >= 32) {
    return Buffer.from(envSecret, "utf8");
  }

  const path = resolve(dataDir, "server-secret");
  try {
    return readFileSync(path);
  } catch {
    const secret = randomBytes(32);
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, secret, { mode: 0o600 });
    } catch {
      console.warn("Could not persist server secret; using an in-memory secret for this process.");
    }
    return secret;
  }
}

function writableDataDir(): string {
  const requested = resolve(process.env.DATA_DIR ?? ".data");
  if (canWriteDirectory(requested)) {
    return requested;
  }

  const fallback = resolve(tmpdir(), "labelbridge-mcp-data");
  if (canWriteDirectory(fallback)) {
    console.warn(`DATA_DIR is not writable; using fallback data directory: ${fallback}`);
    return fallback;
  }

  throw new Error(`No writable data directory found. Tried ${requested} and ${fallback}.`);
}

function canWriteDirectory(path: string): boolean {
  try {
    mkdirSync(path, { recursive: true });
    const probe = resolve(path, `.labelbridge-write-test-${process.pid}-${Date.now()}`);
    writeFileSync(probe, "ok", { mode: 0o600 });
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function loadConfig(): AppConfig {
  const port = parsePort(process.env.PORT);
  const host = process.env.HOST ?? "0.0.0.0";
  const dataDir = writableDataDir();
  const databasePath = resolve(process.env.DATABASE_PATH ?? `${dataDir}/labelbridge.sqlite`);

  const rawPublicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
  const publicBaseUrl = (rawPublicBaseUrl || `http://localhost:${port}`).replace(/\/+$/, "");
  return {
    host,
    port,
    publicBaseUrl,
    publicBaseUrlExplicit: Boolean(rawPublicBaseUrl),
    dataDir,
    databasePath,
    serverSecret: loadOrCreateSecret(dataDir),
  };
}
