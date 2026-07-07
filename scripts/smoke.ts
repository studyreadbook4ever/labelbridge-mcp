import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { webcrypto } from "node:crypto";
import { base64url, fromBase64url } from "../src/security.js";

const baseUrl = process.env.SMOKE_MCP_URL ?? "http://127.0.0.1:3123/mcp";
const client = new Client({ name: "labelbridge-smoke", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(baseUrl));

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  if (!toolNames.includes("create_labeling_session") || !toolNames.includes("ingest_labeling_result")) {
    throw new Error(`Missing expected tools: ${toolNames.join(", ")}`);
  }

  const created = await client.callTool({
    name: "create_labeling_session",
    arguments: {
      task_title: "Smoke Semantic Labeling",
      task_description: "각 항목의 의미를 짧게 라벨링합니다.",
      items: [
        { id: "sample_1", text: "카카오톡 나에게 보내기로 옮긴 에어컨 사진", hint: "전자제품" },
        { id: "sample_2", text: "회의 녹취 요약 문장", hint: "문서" },
      ],
      expires_in_minutes: 60,
    },
  });

  const structured = created.structuredContent as { form_url?: string; session_id?: string };
  if (!structured.form_url || !structured.session_id) {
    throw new Error("create_labeling_session did not return form_url/session_id");
  }
  if ("html" in structured || "security_model" in structured) {
    throw new Error("create_labeling_session returned oversized structured content");
  }

  const response = await fetch(structured.form_url);
  if (!response.ok) {
    throw new Error(`form_url returned ${response.status}`);
  }
  const html = await response.text();
  if (!html.includes("Smoke Semantic Labeling") || !html.includes("labelbridge.form.v1")) {
    throw new Error("Generated HTML did not contain expected form data");
  }
  if (html.includes("defaultValue")) {
    throw new Error("Generated HTML should not contain default answer values");
  }
  const formData = extractFormData(html);
  const capabilityToken = new URL(structured.form_url).searchParams.get("cap");
  if (!capabilityToken) {
    throw new Error("form_url did not contain capability token");
  }

  const resultJson = await makeResultJson(formData, capabilityToken);
  const ingested = await client.callTool({
    name: "ingest_labeling_result",
    arguments: {
      result_json: resultJson,
    },
  });
  const ingestedStructured = ingested.structuredContent as {
    accepted?: boolean;
    labeled_data?: Array<{
      id?: string;
      text?: string;
      hint?: string;
      labels?: { label?: string; confidence?: string };
      _labelbridge?: { session_id?: string; batch_hash?: string; schema_hash?: string; item_hash?: string };
    }>;
  };
  const first = ingestedStructured.labeled_data?.[0];
  const second = ingestedStructured.labeled_data?.[1];
  if (!ingestedStructured.accepted || first?.labels?.label !== "home_appliance_photo") {
    throw new Error("ingest_labeling_result did not return expected labeled data");
  }
  if (first.id !== "sample_1" || first.hint !== "전자제품" || !first._labelbridge?.schema_hash) {
    throw new Error("First labeled dictionary did not preserve source fields and LabelBridge metadata");
  }
  if (second?.labels?.label !== "meeting_summary" || second._labelbridge?.session_id !== structured.session_id) {
    throw new Error("Second labeled dictionary did not contain expected label/session metadata");
  }

  const replay = await client.callTool({
    name: "ingest_labeling_result",
    arguments: {
      result_json: resultJson,
    },
  });
  if (!("isError" in replay) || replay.isError !== true) {
    throw new Error("Replay submission was not rejected");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        tools: toolNames,
        session_id: structured.session_id,
        form_url: structured.form_url,
        ingest: "accepted",
        replay: "rejected",
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}

interface SmokeFormData {
  form_version: string;
  session: {
    session_id: string;
    batch_hash: string;
    schema_hash: string;
    issued_at: string;
    expires_at: string;
  };
  result_key: string;
  items: Array<{ id: string; item_hash: string }>;
}

function extractFormData(html: string): SmokeFormData {
  const match = html.match(/const DATA = (.*?);\n\n    const state =/s);
  if (!match?.[1]) {
    throw new Error("Could not extract embedded form data");
  }
  return JSON.parse(match[1]) as SmokeFormData;
}

async function makeResultJson(data: SmokeFormData, capabilityToken: string): Promise<string> {
  const payload = {
    type: "labelbridge.result.payload.v1",
    session_id: data.session.session_id,
    batch_hash: data.session.batch_hash,
    completed_at: new Date().toISOString(),
    integrity: {
      schema_hash: data.session.schema_hash,
      item_count: data.items.length,
      issued_at: data.session.issued_at,
      expires_at: data.session.expires_at,
    },
    labels: data.items.map((item, index) => ({
      item_id: item.id,
      item_hash: item.item_hash,
      fields: {
        label: index === 0 ? "home_appliance_photo" : "meeting_summary",
        confidence: index === 0 ? "high" : "medium",
      },
    })),
    client: {
      timezone: "Asia/Seoul",
      exported_from: "labelbridge-html",
      form_version: data.form_version,
    },
  };

  const key = await webcrypto.subtle.importKey(
    "raw",
    toArrayBuffer(fromBase64url(data.result_key)),
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

  return JSON.stringify({
    type: "labelbridge.result.envelope.v1",
    session_id: data.session.session_id,
    batch_hash: data.session.batch_hash,
    capability_token: capabilityToken,
    encryption: {
      alg: "AES-256-GCM",
      iv: base64url(iv),
      ciphertext: base64url(ciphertext),
    },
    created_at: new Date().toISOString(),
    tool_hint: "smoke test",
  });
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
