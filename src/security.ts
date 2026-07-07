import { createHmac, randomBytes, timingSafeEqual, webcrypto } from "node:crypto";

export function base64url(input: Buffer | ArrayBuffer | Uint8Array): string {
  return Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input).toString("base64url");
}

export function fromBase64url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

export function capabilityDigest(token: string, serverSecret: Buffer): string {
  return createHmac("sha256", serverSecret).update(token, "utf8").digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export async function decryptAesGcmJson<T>(params: {
  keyBase64url: string;
  ivBase64url: string;
  ciphertextBase64url: string;
}): Promise<T> {
  const key = await webcrypto.subtle.importKey(
    "raw",
    toArrayBuffer(fromBase64url(params.keyBase64url)),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(fromBase64url(params.ivBase64url)) },
    key,
    toArrayBuffer(fromBase64url(params.ciphertextBase64url)),
  );
  return JSON.parse(Buffer.from(plaintext).toString("utf8")) as T;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
