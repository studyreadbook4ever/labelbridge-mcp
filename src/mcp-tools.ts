import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { AppConfig } from "./config.js";
import { batchHashForSession, labelSchemaHash } from "./integrity.js";
import {
  createLabelingSessionInputSchema,
  ingestResultInputSchema,
  inspectSessionInputSchema,
  jsonValueSchema,
  normalizeItems,
  normalizeLabelFields,
} from "./schemas.js";
import { capabilityDigest, decryptAesGcmJson, randomToken } from "./security.js";
import type { JsonObject, LabelingSession, ResultEnvelope, ResultPayload } from "./types.js";
import { LabelBridgeError, LabelBridgeStorage } from "./storage.js";

export interface ToolContext {
  storage: LabelBridgeStorage;
  config: AppConfig;
}

const base64urlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

const resultEnvelopeSchema = z
  .object({
    type: z.literal("labelbridge.result.envelope.v1"),
    session_id: z.string().uuid(),
    batch_hash: z.string().min(32),
    capability_token: base64urlSchema.min(32),
    encryption: z
      .object({
        alg: z.literal("AES-256-GCM"),
        iv: base64urlSchema.min(16),
        ciphertext: base64urlSchema.min(16),
      })
      .strict(),
    created_at: z.string(),
    tool_hint: z.string().optional(),
  })
  .strict();

const resultPayloadSchema: z.ZodType<ResultPayload> = z
  .object({
    type: z.literal("labelbridge.result.payload.v1"),
    session_id: z.string().uuid(),
    batch_hash: z.string(),
    completed_at: z.string(),
    integrity: z
      .object({
        schema_hash: z.string(),
        item_count: z.number().int().min(1),
        issued_at: z.string(),
        expires_at: z.string(),
      })
      .strict(),
    labels: z.array(
      z
        .object({
          item_id: z.string(),
          item_hash: z.string(),
          fields: z.record(z.string(), jsonValueSchema),
        })
        .strict(),
    ),
    client: z
      .object({
        timezone: z.string(),
        exported_from: z.literal("labelbridge-html"),
        form_version: z.string(),
      })
      .strict(),
  })
  .strict();

const createOutputSchema = {
  session_id: z.string().uuid(),
  form_url: z.string().url(),
  download_url: z.string().url(),
  filename: z.string(),
  expires_at: z.string(),
  item_count: z.number().int(),
};

const ingestOutputSchema = {
  accepted: z.literal(true),
  session_id: z.string().uuid(),
  consumed_at: z.string(),
  item_count: z.number().int(),
  batch_hash: z.string(),
  schema_hash: z.string(),
  labeled_data: z.array(z.record(z.string(), jsonValueSchema)),
};

const inspectOutputSchema = {
  session_id: z.string().uuid(),
  status: z.enum(["issued", "consumed", "expired"]),
  item_count: z.number().int(),
  issued_at: z.string(),
  expires_at: z.string(),
  consumed_at: z.string().nullable(),
  form_render_count: z.number().int(),
  batch_hash: z.string(),
};

export function createMcpServer(context: ToolContext): McpServer {
  const server = new McpServer(
    {
      name: "LabelBridge MCP",
      version: "0.1.0",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  server.registerTool(
    "create_labeling_session",
    {
      title: "Create one-time semantic labeling form",
      description:
        "LabelBridge(레이블브릿지) creates a blank-only HTML labeling form from an array. It never suggests answers; a human fills every semantic field, then returns encrypted answer JSON for one-time ingest.",
      inputSchema: createLabelingSessionInputSchema,
      outputSchema: createOutputSchema,
      annotations: {
        title: "Create Labeling Form",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const labelFields = normalizeLabelFields(input.label_fields);
      const items = normalizeItems({
        items: input.items,
        itemIdField: input.item_id_field,
        displayFields: input.display_fields,
      });
      const capabilityToken = randomToken(32);
      const resultKey = randomToken(32);
      const expiresAt = new Date(Date.now() + input.expires_in_minutes * 60_000).toISOString();
      const batchHash = batchHashForSession({
        taskTitle: input.task_title,
        taskDescription: input.task_description,
        labelFields,
        items,
      });

      const session = context.storage.createSession({
        taskTitle: input.task_title,
        taskDescription: input.task_description,
        items,
        labelFields,
        expiresAt,
        capabilityDigest: capabilityDigest(capabilityToken, context.config.serverSecret),
        batchHash,
        resultKey,
      });

      const urls = makeFormUrls(context.config.publicBaseUrl, session, capabilityToken);
      const structuredContent = {
        session_id: session.sessionId,
        form_url: urls.formUrl,
        download_url: urls.downloadUrl,
        filename: urls.filename,
        expires_at: session.expiresAt,
        item_count: session.itemCount,
      };

      return {
        content: [
          {
            type: "text",
            text: [
              `LabelBridge 세션이 만들어졌습니다: ${session.sessionId}`,
              `폼 열기: ${urls.formUrl}`,
              `HTML 파일 다운로드: ${urls.downloadUrl}`,
              "사용자가 공유, 복사, 또는 다운로드한 답안 JSON 전체를 ingest_labeling_result 도구에 넣어 주세요.",
            ].join("\n"),
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "ingest_labeling_result",
    {
      title: "Ingest completed one-time labeling result",
      description:
        "LabelBridge(레이블브릿지) ingests answer JSON created by its HTML form, validates hashes and the one-time capability, consumes it atomically, and returns AI-native labeled dictionaries.",
      inputSchema: ingestResultInputSchema,
      outputSchema: ingestOutputSchema,
      annotations: {
        title: "Ingest Labeling Result",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const envelope = parseResultEnvelope(input.result_json);
      validateEnvelopeEncoding(envelope);
      const session = context.storage.getSession(envelope.session_id);
      const digest = capabilityDigest(envelope.capability_token, context.config.serverSecret);
      context.storage.verifyCapability(session, digest);
      if (session.batchHash !== envelope.batch_hash) {
        throw new LabelBridgeError("결과 파일의 batch_hash가 세션과 일치하지 않습니다.", "invalid_result");
      }

      const decrypted = await decryptAesGcmJson<unknown>({
        keyBase64url: session.resultKey,
        ivBase64url: envelope.encryption.iv,
        ciphertextBase64url: envelope.encryption.ciphertext,
      });
      const payload = resultPayloadSchema.parse(decrypted);
      const consumed = context.storage.consumeResult({
        sessionId: session.sessionId,
        capabilityDigest: digest,
        payload,
      });

      const labeledData = consumed.items.map((item) => ({
        ...item.source,
        labels: item.labels,
        _labelbridge: item.labelbridge,
      })) as JsonObject[];

      const structuredContent = {
        accepted: true as const,
        session_id: session.sessionId,
        consumed_at: consumed.consumedAt,
        item_count: labeledData.length,
        batch_hash: session.batchHash,
        schema_hash: labelSchemaHash(session.labelFields),
        labeled_data: labeledData,
      };

      return {
        content: [
          {
            type: "text",
            text: `라벨링 결과를 수락했습니다. ${labeledData.length}개 항목이 AI-native dictionary 배열로 반환되었습니다.`,
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "inspect_labeling_session",
    {
      title: "Inspect LabelBridge session",
      description:
        "LabelBridge(레이블브릿지) checks one-time labeling status without exposing the capability token or raw human labels.",
      inputSchema: inspectSessionInputSchema,
      outputSchema: inspectOutputSchema,
      annotations: {
        title: "Inspect Session",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ session_id }) => {
      const session = context.storage.getSession(session_id);
      const structuredContent = {
        session_id: session.sessionId,
        status: session.status,
        item_count: session.itemCount,
        issued_at: session.issuedAt,
        expires_at: session.expiresAt,
        consumed_at: session.consumedAt,
        form_render_count: session.formRenderCount,
        batch_hash: session.batchHash,
      };
      return {
        content: [
          {
            type: "text",
            text: `세션 ${session.sessionId}: ${session.status}`,
          },
        ],
        structuredContent,
      };
    },
  );

  return server;
}

export function makeFormUrls(
  publicBaseUrl: string,
  session: Pick<LabelingSession, "sessionId">,
  capabilityToken: string,
): { formUrl: string; downloadUrl: string; filename: string } {
  const query = new URLSearchParams({ cap: capabilityToken });
  const filename = `labelbridge-form-${session.sessionId.slice(0, 8)}.html`;
  const base = `${publicBaseUrl}/forms/${session.sessionId}`;
  return {
    formUrl: `${base}?${query.toString()}`,
    downloadUrl: `${base}/download?${query.toString()}`,
    filename,
  };
}

function parseResultEnvelope(value: string | Record<string, unknown>): ResultEnvelope {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  return resultEnvelopeSchema.parse(raw) as ResultEnvelope;
}

function validateEnvelopeEncoding(envelope: ResultEnvelope): void {
  if (Buffer.from(envelope.encryption.iv, "base64url").byteLength !== 12) {
    throw new LabelBridgeError("AES-GCM IV 길이가 올바르지 않습니다.", "invalid_result");
  }
  if (Buffer.from(envelope.capability_token, "base64url").byteLength < 32) {
    throw new LabelBridgeError("세션 사용권 길이가 올바르지 않습니다.", "invalid_capability");
  }
  if (!Number.isFinite(Date.parse(envelope.created_at))) {
    throw new LabelBridgeError("결과 파일 생성 시간이 올바르지 않습니다.", "invalid_result");
  }
}
