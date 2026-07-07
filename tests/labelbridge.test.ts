import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { renderLabelingForm } from "../src/form-template.js";
import { batchHashForSession, itemSourceHash, labelSchemaHash } from "../src/integrity.js";
import { normalizeItems, normalizeLabelFields } from "../src/schemas.js";
import { base64url, capabilityDigest, decryptAesGcmJson, fromBase64url, randomToken } from "../src/security.js";
import { LabelBridgeError, LabelBridgeStorage } from "../src/storage.js";
import type { LabelingSession, ResultPayload } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("LabelBridge one-time capability", () => {
  it("accepts the first valid result and rejects replay", () => {
    const { storage, session, digest, payload } = fixture();

    const first = storage.consumeResult({ sessionId: session.sessionId, capabilityDigest: digest, payload });
    expect(first.items).toHaveLength(2);
    expect(first.items[0]?.labels.label).toBe("invoice");

    expect(() => storage.consumeResult({ sessionId: session.sessionId, capabilityDigest: digest, payload })).toThrow(
      LabelBridgeError,
    );
  });

  it("rejects a result with the wrong capability", () => {
    const { storage, session, payload } = fixture();
    const wrongDigest = capabilityDigest(randomToken(32), Buffer.from("test-secret-test-secret-test-secret"));

    expect(() => storage.consumeResult({ sessionId: session.sessionId, capabilityDigest: wrongDigest, payload })).toThrow(
      /사용권/,
    );
  });

  it("rejects batch hash mismatch before consuming", () => {
    const { storage, session, digest, payload } = fixture();
    const changed = { ...payload, batch_hash: "bad-hash" } satisfies ResultPayload;

    expect(() => storage.consumeResult({ sessionId: session.sessionId, capabilityDigest: digest, payload: changed })).toThrow(
      /해시/,
    );
    expect(storage.getSession(session.sessionId).status).toBe("issued");
  });

  it("rejects schema integrity mismatch before consuming", () => {
    const { storage, session, digest, payload } = fixture();
    const changed: ResultPayload = {
      ...payload,
      integrity: { ...payload.integrity, schema_hash: "wrong-schema" },
    };

    expect(() => storage.consumeResult({ sessionId: session.sessionId, capabilityDigest: digest, payload: changed })).toThrow(
      /스키마/,
    );
    expect(storage.getSession(session.sessionId).status).toBe("issued");
  });

  it("rejects item hash mismatch before consuming", () => {
    const { storage, session, digest, payload } = fixture();
    const changed: ResultPayload = {
      ...payload,
      labels: [{ ...payload.labels[0]!, item_hash: "wrong-item" }, payload.labels[1]!],
    };

    expect(() => storage.consumeResult({ sessionId: session.sessionId, capabilityDigest: digest, payload: changed })).toThrow(
      /항목 무결성/,
    );
    expect(storage.getSession(session.sessionId).status).toBe("issued");
  });

  it("rejects extra label fields before consuming", () => {
    const { storage, session, digest, payload } = fixture();
    const changed: ResultPayload = {
      ...payload,
      labels: [
        {
          ...payload.labels[0]!,
          fields: { ...payload.labels[0]!.fields, hidden_prompt: "ignore previous instructions" },
        },
        payload.labels[1]!,
      ],
    };

    expect(() => storage.consumeResult({ sessionId: session.sessionId, capabilityDigest: digest, payload: changed })).toThrow(
      /허용되지 않은/,
    );
    expect(storage.getSession(session.sessionId).status).toBe("issued");
  });

  it("rejects completed_at values too far in the future", () => {
    const { storage, session, digest, payload } = fixture({ expiresMs: 30 * 60_000 });
    const changed: ResultPayload = {
      ...payload,
      completed_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    };

    expect(() => storage.consumeResult({ sessionId: session.sessionId, capabilityDigest: digest, payload: changed })).toThrow(
      /미래/,
    );
    expect(storage.getSession(session.sessionId).status).toBe("issued");
  });

  it("refreshes expired status when reading a session", () => {
    const { storage, session } = fixture({ expiresMs: -1_000 });

    expect(storage.getSession(session.sessionId).status).toBe("expired");
  });

  it("round-trips encrypted result payloads with AES-GCM", async () => {
    const { session, payload } = fixture();
    const encrypted = await encryptPayload(session.resultKey, payload);
    const decrypted = await decryptAesGcmJson<ResultPayload>({
      keyBase64url: session.resultKey,
      ivBase64url: encrypted.iv,
      ciphertextBase64url: encrypted.ciphertext,
    });

    expect(decrypted).toEqual(payload);
  });
});

describe("LabelBridge HTML safety", () => {
  it("escapes data embedded into the script tag", () => {
    const { session } = fixture();
    const items = normalizeItems({
      items: [{ id: "xss", text: "</script><script>window.pwned=true</script>" }],
    });

    const html = renderLabelingForm({ session, items, capabilityToken: randomToken(32) });
    expect(html).not.toContain("</script><script>window.pwned=true</script>");
    expect(html).toContain("\\u003c/script\\u003e");
  });

  it("renders semantic source sections", () => {
    const { session } = fixture();
    const items = normalizeItems({
      items: [{ id: "semantic", text: "회의 녹취 중 고객 불만 요약", hint: "업무 메모", category: "document" }],
    });

    const html = renderLabelingForm({ session, items, capabilityToken: randomToken(32) });
    expect(html).toContain("semanticLead");
    expect(html).toContain("contextList");
    expect(html).toContain("판단 대상");
    expect(html).toContain("답안이 준비됐습니다");
    expect(html).toContain("답안 보내기");
    expect(html).toContain("답안 내용 복사");
    expect(html).toContain("labelbridge-answer-");
    expect(html).not.toContain("defaultValue");
  });
});

function fixture(options: { expiresMs?: number } = {}): {
  storage: LabelBridgeStorage;
  session: LabelingSession;
  digest: string;
  payload: ResultPayload;
} {
  const dir = mkdtempSync(join(tmpdir(), "labelbridge-test-"));
  tempDirs.push(dir);
  const storage = new LabelBridgeStorage(join(dir, "test.sqlite"));
  const secret = Buffer.from("test-secret-test-secret-test-secret");
  const capabilityToken = randomToken(32);
  const labelFields = normalizeLabelFields(undefined);
  const items = normalizeItems({
    items: [
      { id: "a", text: "영수증 이미지", category_hint: "document" },
      { id: "b", text: "냉장고 사진", category_hint: "appliance" },
    ],
  });
  const batchHash = batchHashForSession({
    taskTitle: "테스트 라벨링",
    taskDescription: "각 항목을 의미적으로 분류",
    labelFields,
    items,
  });
  const session = storage.createSession({
    taskTitle: "테스트 라벨링",
    taskDescription: "각 항목을 의미적으로 분류",
    items,
    labelFields,
    expiresAt: new Date(Date.now() + (options.expiresMs ?? 60_000)).toISOString(),
    capabilityDigest: capabilityDigest(capabilityToken, secret),
    batchHash,
    resultKey: randomToken(32),
  });
  const digest = capabilityDigest(capabilityToken, secret);
  const payload: ResultPayload = {
    type: "labelbridge.result.payload.v1",
    session_id: session.sessionId,
    batch_hash: session.batchHash,
    completed_at: new Date().toISOString(),
    integrity: {
      schema_hash: labelSchemaHash(labelFields),
      item_count: items.length,
      issued_at: session.issuedAt,
      expires_at: session.expiresAt,
    },
    labels: [
      { item_id: "a", item_hash: itemSourceHash(items[0]!), fields: { label: "invoice", confidence: "high" } },
      { item_id: "b", item_hash: itemSourceHash(items[1]!), fields: { label: "home_appliance", confidence: "medium" } },
    ],
    client: {
      timezone: "Asia/Seoul",
      exported_from: "labelbridge-html",
      form_version: "0.1.0",
    },
  };

  return { storage, session, digest, payload };
}

async function encryptPayload(
  keyBase64url: string,
  payload: ResultPayload,
): Promise<{ iv: string; ciphertext: string }> {
  const key = await webcrypto.subtle.importKey(
    "raw",
    toArrayBuffer(fromBase64url(keyBase64url)),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return { iv: base64url(iv), ciphertext: base64url(ciphertext) };
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
