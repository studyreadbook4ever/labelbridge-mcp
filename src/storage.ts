import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CreateSessionInput,
  IngestedItem,
  JsonObject,
  JsonValue,
  LabelField,
  LabelingSession,
  NormalizedItem,
  ResultPayload,
} from "./types.js";
import { safeEqual } from "./security.js";
import { itemSourceHash, labelSchemaHash } from "./integrity.js";

interface SessionRow {
  session_id: string;
  capability_digest: string;
  batch_hash: string;
  result_key: string;
  task_title: string;
  task_description: string;
  label_fields_json: string;
  item_count: number;
  status: "issued" | "consumed" | "expired";
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  form_render_count: number;
  last_rendered_at: string | null;
}

interface ItemRow {
  item_id: string;
  item_index: number;
  source_json: string;
  display_json: string;
}

export class LabelBridgeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "expired"
      | "already_consumed"
      | "invalid_capability"
      | "invalid_result"
      | "conflict",
  ) {
    super(message);
    this.name = "LabelBridgeError";
  }
}

export class LabelBridgeStorage {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA trusted_schema = OFF");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createSession(input: CreateSessionInput): LabelingSession {
    const sessionId = crypto.randomUUID();
    const issuedAt = new Date().toISOString();

    const insertSession = this.db.prepare(`
      INSERT INTO sessions (
        session_id, capability_digest, batch_hash, result_key, task_title, task_description,
        label_fields_json, item_count, status, issued_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)
    `);
    const insertItem = this.db.prepare(`
      INSERT INTO session_items (session_id, item_id, item_index, source_json, display_json)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      insertSession.run(
        sessionId,
        input.capabilityDigest,
        input.batchHash,
        input.resultKey,
        input.taskTitle,
        input.taskDescription,
        JSON.stringify(input.labelFields),
        input.items.length,
        issuedAt,
        input.expiresAt,
      );
      for (const item of input.items) {
        insertItem.run(
          sessionId,
          item.id,
          item.index,
          JSON.stringify(item.source),
          JSON.stringify(item.display),
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return this.getSession(sessionId);
  }

  getSession(sessionId: string): LabelingSession {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId) as SessionRow | undefined;
    if (!row) {
      throw new LabelBridgeError("라벨링 세션을 찾을 수 없습니다.", "not_found");
    }
    const session = this.mapSession(row);
    this.expireIfNeeded(session);
    return session;
  }

  getItems(sessionId: string): NormalizedItem[] {
    const rows = this.db
      .prepare("SELECT * FROM session_items WHERE session_id = ? ORDER BY item_index ASC")
      .all(sessionId) as unknown as ItemRow[];
    return rows.map((row) => ({
      id: row.item_id,
      index: row.item_index,
      source: JSON.parse(row.source_json) as JsonObject,
      display: JSON.parse(row.display_json) as JsonObject,
    }));
  }

  getSessionWithItems(sessionId: string): { session: LabelingSession; items: NormalizedItem[] } {
    return { session: this.getSession(sessionId), items: this.getItems(sessionId) };
  }

  recordFormRendered(sessionId: string): void {
    this.db
      .prepare(
        "UPDATE sessions SET form_render_count = form_render_count + 1, last_rendered_at = ? WHERE session_id = ?",
      )
      .run(new Date().toISOString(), sessionId);
  }

  consumeResult(params: {
    sessionId: string;
    capabilityDigest: string;
    payload: ResultPayload;
  }): { consumedAt: string; items: IngestedItem[] } {
    const consumedAt = new Date().toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const session = this.getSession(params.sessionId);
      this.assertSessionCanConsume(session, params.capabilityDigest, params.payload.batch_hash);
      const items = this.getItems(params.sessionId);
      const labelsByItem = this.validatePayloadAgainstSession(params.payload, session, items);

      const result = this.db
        .prepare(
          "UPDATE sessions SET status = 'consumed', consumed_at = ? WHERE session_id = ? AND status = 'issued'",
        )
        .run(consumedAt, params.sessionId);

      if (result.changes !== 1) {
        throw new LabelBridgeError("이미 제출된 세션입니다.", "already_consumed");
      }

      this.db
        .prepare("INSERT INTO results (session_id, result_json, consumed_at) VALUES (?, ?, ?)")
        .run(params.sessionId, JSON.stringify(params.payload), consumedAt);

      this.db.exec("COMMIT");

      return {
        consumedAt,
        items: items.map((item) => ({
          id: item.id,
          source: item.source,
          labels: labelsByItem.get(item.id) ?? {},
          labelbridge: {
            session_id: session.sessionId,
            batch_hash: session.batchHash,
            schema_hash: labelSchemaHash(session.labelFields),
            item_hash: itemSourceHash(item),
            consumed_at: consumedAt,
            item_index: item.index,
          },
        })),
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  verifyCapability(session: LabelingSession, capabilityDigest: string): void {
    if (!safeEqual(session.capabilityDigest, capabilityDigest)) {
      throw new LabelBridgeError("세션 사용권이 일치하지 않습니다.", "invalid_capability");
    }
  }

  assertSessionCanView(session: LabelingSession, capabilityDigest: string): void {
    this.verifyCapability(session, capabilityDigest);
    this.expireIfNeeded(session);
    if (session.status === "expired") {
      throw new LabelBridgeError("만료된 라벨링 세션입니다.", "expired");
    }
    if (session.status === "consumed") {
      throw new LabelBridgeError("이미 제출된 세션입니다.", "already_consumed");
    }
  }

  private assertSessionCanConsume(session: LabelingSession, capabilityDigest: string, batchHash: string): void {
    this.verifyCapability(session, capabilityDigest);
    this.expireIfNeeded(session);
    if (session.status === "expired") {
      throw new LabelBridgeError("만료된 라벨링 세션입니다.", "expired");
    }
    if (session.status === "consumed") {
      throw new LabelBridgeError("이미 제출된 세션입니다.", "already_consumed");
    }
    if (session.batchHash !== batchHash) {
      throw new LabelBridgeError("원본 데이터 해시가 일치하지 않습니다.", "invalid_result");
    }
  }

  private expireIfNeeded(session: LabelingSession): void {
    if (session.status !== "issued") {
      return;
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.db.prepare("UPDATE sessions SET status = 'expired' WHERE session_id = ?").run(session.sessionId);
      session.status = "expired";
    }
  }

  private validatePayloadAgainstSession(
    payload: ResultPayload,
    session: LabelingSession,
    items: NormalizedItem[],
  ): Map<string, Record<string, JsonValue>> {
    if (payload.type !== "labelbridge.result.payload.v1") {
      throw new LabelBridgeError("지원하지 않는 결과 payload입니다.", "invalid_result");
    }
    if (payload.session_id !== session.sessionId || payload.batch_hash !== session.batchHash) {
      throw new LabelBridgeError("결과 파일이 이 세션과 맞지 않습니다.", "invalid_result");
    }
    if (payload.labels.length !== items.length) {
      throw new LabelBridgeError("라벨 개수가 원본 항목 개수와 다릅니다.", "invalid_result");
    }
    this.validatePayloadIntegrity(payload, session, items);

    const itemIds = new Set(items.map((item) => item.id));
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const labelsByItem = new Map<string, Record<string, JsonValue>>();
    const fieldIds = new Set(session.labelFields.map((field) => field.id));

    for (const entry of payload.labels) {
      if (!itemIds.has(entry.item_id)) {
        throw new LabelBridgeError(`알 수 없는 항목 ID입니다: ${entry.item_id}`, "invalid_result");
      }
      const item = itemsById.get(entry.item_id);
      if (!item || entry.item_hash !== itemSourceHash(item)) {
        throw new LabelBridgeError(`항목 무결성 해시가 일치하지 않습니다: ${entry.item_id}`, "invalid_result");
      }
      if (seen.has(entry.item_id)) {
        throw new LabelBridgeError(`중복된 항목 ID입니다: ${entry.item_id}`, "invalid_result");
      }
      seen.add(entry.item_id);
      for (const fieldId of Object.keys(entry.fields)) {
        if (!fieldIds.has(fieldId)) {
          throw new LabelBridgeError(`허용되지 않은 라벨 필드입니다: ${fieldId}`, "invalid_result");
        }
      }

      const normalizedFields: Record<string, JsonValue> = {};
      for (const field of session.labelFields) {
        const value = entry.fields[field.id];
        if (field.required && isBlank(value)) {
          throw new LabelBridgeError(`필수 라벨이 비어 있습니다: ${field.label}`, "invalid_result");
        }
        if (!isBlank(value)) {
          normalizedFields[field.id] = validateFieldValue(field, value as JsonValue);
        }
      }
      labelsByItem.set(entry.item_id, normalizedFields);
    }

    return labelsByItem;
  }

  private validatePayloadIntegrity(payload: ResultPayload, session: LabelingSession, items: NormalizedItem[]): void {
    if (payload.integrity.schema_hash !== labelSchemaHash(session.labelFields)) {
      throw new LabelBridgeError("라벨 스키마 해시가 일치하지 않습니다.", "invalid_result");
    }
    if (payload.integrity.item_count !== items.length) {
      throw new LabelBridgeError("항목 개수 무결성 값이 일치하지 않습니다.", "invalid_result");
    }
    if (payload.integrity.issued_at !== session.issuedAt || payload.integrity.expires_at !== session.expiresAt) {
      throw new LabelBridgeError("세션 시간 무결성 값이 일치하지 않습니다.", "invalid_result");
    }

    const completedAt = Date.parse(payload.completed_at);
    if (!Number.isFinite(completedAt)) {
      throw new LabelBridgeError("완료 시간이 올바르지 않습니다.", "invalid_result");
    }
    if (completedAt < Date.parse(session.issuedAt) || completedAt > Date.parse(session.expiresAt)) {
      throw new LabelBridgeError("완료 시간이 세션 유효 범위를 벗어났습니다.", "invalid_result");
    }
    if (completedAt > Date.now() + 5 * 60_000) {
      throw new LabelBridgeError("완료 시간이 서버 시간보다 지나치게 미래입니다.", "invalid_result");
    }
  }

  private mapSession(row: SessionRow): LabelingSession {
    return {
      sessionId: row.session_id,
      capabilityDigest: row.capability_digest,
      batchHash: row.batch_hash,
      resultKey: row.result_key,
      taskTitle: row.task_title,
      taskDescription: row.task_description,
      labelFields: JSON.parse(row.label_fields_json) as LabelField[],
      itemCount: row.item_count,
      status: row.status,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      formRenderCount: row.form_render_count,
      lastRenderedAt: row.last_rendered_at,
    };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        capability_digest TEXT NOT NULL UNIQUE,
        batch_hash TEXT NOT NULL,
        result_key TEXT NOT NULL,
        task_title TEXT NOT NULL,
        task_description TEXT NOT NULL,
        label_fields_json TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('issued', 'consumed', 'expired')),
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        form_render_count INTEGER NOT NULL DEFAULT 0,
        last_rendered_at TEXT
      );

      CREATE TABLE IF NOT EXISTS session_items (
        session_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_index INTEGER NOT NULL,
        source_json TEXT NOT NULL,
        display_json TEXT NOT NULL,
        PRIMARY KEY (session_id, item_id),
        UNIQUE (session_id, item_index),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS results (
        session_id TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        consumed_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_status_expires ON sessions(status, expires_at);
    `);
  }
}

function isBlank(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

function validateFieldValue(field: LabelField, value: JsonValue): JsonValue {
  switch (field.type) {
    case "text":
    case "textarea": {
      if (typeof value !== "string") {
        throw new LabelBridgeError(`${field.label} 값은 문자열이어야 합니다.`, "invalid_result");
      }
      const trimmed = value.trim();
      if (field.maxLength && trimmed.length > field.maxLength) {
        throw new LabelBridgeError(`${field.label} 값이 너무 깁니다.`, "invalid_result");
      }
      return trimmed;
    }
    case "select": {
      if (typeof value !== "string" || !field.options?.some((option) => option.value === value)) {
        throw new LabelBridgeError(`${field.label} 선택지가 올바르지 않습니다.`, "invalid_result");
      }
      return value;
    }
    case "multi_select": {
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
        throw new LabelBridgeError(`${field.label} 값은 문자열 배열이어야 합니다.`, "invalid_result");
      }
      const allowed = new Set(field.options?.map((option) => option.value) ?? []);
      if (!value.every((entry) => allowed.has(entry))) {
        throw new LabelBridgeError(`${field.label} 선택지가 올바르지 않습니다.`, "invalid_result");
      }
      return value;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        throw new LabelBridgeError(`${field.label} 값은 참/거짓이어야 합니다.`, "invalid_result");
      }
      return value;
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw new LabelBridgeError(`${field.label} 값은 숫자여야 합니다.`, "invalid_result");
      }
      if (field.min !== undefined && value < field.min) {
        throw new LabelBridgeError(`${field.label} 값이 너무 작습니다.`, "invalid_result");
      }
      if (field.max !== undefined && value > field.max) {
        throw new LabelBridgeError(`${field.label} 값이 너무 큽니다.`, "invalid_result");
      }
      return value;
    }
  }
}
