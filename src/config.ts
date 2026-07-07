import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export interface AppConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
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
    mkdirSync(dirname(path), { recursive: true });
    const secret = randomBytes(32);
    writeFileSync(path, secret, { mode: 0o600 });
    return secret;
  }
}

export function loadConfig(): AppConfig {
  const port = parsePort(process.env.PORT);
  const host = process.env.HOST ?? "0.0.0.0";
  const dataDir = resolve(process.env.DATA_DIR ?? ".data");
  const databasePath = resolve(process.env.DATABASE_PATH ?? `${dataDir}/labelbridge.sqlite`);
  mkdirSync(dataDir, { recursive: true });

  const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, "");
  return {
    host,
    port,
    publicBaseUrl,
    dataDir,
    databasePath,
    serverSecret: loadOrCreateSecret(dataDir),
  };
}
