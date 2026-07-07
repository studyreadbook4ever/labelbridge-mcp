export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type LabelFieldType = "text" | "textarea" | "select" | "multi_select" | "boolean" | "number";

export interface LabelFieldOption {
  value: string;
  label: string;
}

export interface LabelField {
  id: string;
  label: string;
  type: LabelFieldType;
  required: boolean;
  description?: string;
  placeholder?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: LabelFieldOption[];
  defaultValue?: JsonValue;
}

export interface NormalizedItem {
  id: string;
  index: number;
  source: JsonObject;
  display: JsonObject;
}

export interface LabelingSession {
  sessionId: string;
  capabilityDigest: string;
  batchHash: string;
  resultKey: string;
  taskTitle: string;
  taskDescription: string;
  labelFields: LabelField[];
  itemCount: number;
  status: "issued" | "consumed" | "expired";
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  formRenderCount: number;
  lastRenderedAt: string | null;
}

export interface CreateSessionInput {
  taskTitle: string;
  taskDescription: string;
  items: NormalizedItem[];
  labelFields: LabelField[];
  expiresAt: string;
  capabilityDigest: string;
  batchHash: string;
  resultKey: string;
}

export interface ResultLabel {
  item_id: string;
  item_hash: string;
  fields: Record<string, JsonValue>;
}

export interface ResultPayload {
  type: "labelbridge.result.payload.v1";
  session_id: string;
  batch_hash: string;
  completed_at: string;
  integrity: {
    schema_hash: string;
    item_count: number;
    issued_at: string;
    expires_at: string;
  };
  labels: ResultLabel[];
  client: {
    timezone: string;
    exported_from: "labelbridge-html";
    form_version: string;
  };
}

export interface ResultEnvelope {
  type: "labelbridge.result.envelope.v1";
  session_id: string;
  batch_hash: string;
  capability_token: string;
  encryption: {
    alg: "AES-256-GCM";
    iv: string;
    ciphertext: string;
  };
  created_at: string;
  tool_hint: string;
}

export interface IngestedItem {
  id: string;
  source: JsonObject;
  labels: Record<string, JsonValue>;
  labelbridge: {
    session_id: string;
    batch_hash: string;
    schema_hash: string;
    item_hash: string;
    consumed_at: string;
    item_index: number;
  };
}
