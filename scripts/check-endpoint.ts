import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.argv[2] ?? process.env.MCP_ENDPOINT ?? process.env.SMOKE_MCP_URL;

if (!endpoint) {
  throw new Error("Set MCP_ENDPOINT=https://YOUR_DEPLOYED_HOST/mcp or pass the endpoint as the first argument.");
}

const endpointUrl = new URL(endpoint);
const localEndpoint = ["localhost", "127.0.0.1", "::1"].includes(endpointUrl.hostname);
const restrictedNamePattern = new RegExp(["ka", "kao"].join(""), "i");
assert(endpointUrl.pathname.replace(/\/+$/, "").endsWith("/mcp"), "MCP endpoint should end with /mcp.");
if (!localEndpoint) {
  assert(endpointUrl.protocol === "https:", "Public PlayMCP endpoint must use https.");
}

const healthUrl = healthUrlFor(endpointUrl);
const health = await fetchJson<{ ok?: boolean; name?: string; version?: string }>(healthUrl);
assert(health.ok === true, `Health check did not return ok=true from ${healthUrl.toString()}`);

await assertProtocolVersion("2025-03-26");
await assertProtocolVersion("2025-11-25");

const client = new Client({ name: "labelbridge-deployed-endpoint-check", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(endpointUrl);

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  const toolNames = tools.map((tool) => tool.name);
  assert(toolNames.includes("create_labeling_session"), "Missing create_labeling_session tool.");
  assert(toolNames.includes("ingest_labeling_result"), "Missing ingest_labeling_result tool.");
  assert(toolNames.includes("inspect_labeling_session"), "Missing inspect_labeling_session tool.");
  await assertCleanToolError();

  const created = await client.callTool({
    name: "create_labeling_session",
    arguments: {
      task_title: "PlayMCP Endpoint Check",
      task_description: "배포된 LabelBridge MCP endpoint가 실제 폼 URL을 만들고 열 수 있는지 확인합니다.",
      items: [{ id: "endpoint_check", text: "semantic deployment check" }],
      expires_in_minutes: 5,
    },
  });
  const structured = created.structuredContent as { session_id?: string; form_url?: string; download_url?: string };
  assert(typeof structured.session_id === "string", "create_labeling_session did not return session_id.");
  assert(typeof structured.form_url === "string", "create_labeling_session did not return form_url.");
  assert(typeof structured.download_url === "string", "create_labeling_session did not return download_url.");

  const formUrl = new URL(structured.form_url);
  assert(localEndpoint || formUrl.protocol === "https:", `Public form_url must use https: ${redactUrl(formUrl)}`);
  assert(
    localEndpoint || !["localhost", "127.0.0.1", "::1"].includes(formUrl.hostname),
    `Public form_url must not point to localhost: ${redactUrl(formUrl)}`,
  );

  const form = await fetch(formUrl);
  assert(form.ok, `Generated form_url returned HTTP ${form.status}: ${redactUrl(formUrl)}`);
  const html = await form.text();
  assert(html.includes("LabelBridge"), "Generated form HTML did not contain LabelBridge.");
  assert(!html.includes("defaultValue"), "Generated form HTML appears to contain a default answer value.");

  const inspected = await client.callTool({
    name: "inspect_labeling_session",
    arguments: { session_id: structured.session_id },
  });
  const inspectContent = inspected.structuredContent as { status?: string; item_count?: number };
  assert(inspectContent.status === "issued", `Expected issued session, got ${inspectContent.status ?? "unknown"}.`);
  assert(inspectContent.item_count === 1, `Expected item_count=1, got ${inspectContent.item_count ?? "unknown"}.`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint: endpointUrl.toString(),
        healthz: healthUrl.toString(),
        protocols: ["2025-03-26", "2025-11-25"],
        tools: toolNames,
        clean_tool_error: true,
        form_url: redactUrl(formUrl),
        session_status: inspectContent.status,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}

async function assertCleanToolError(): Promise<void> {
  const missing = await client.callTool({
    name: "inspect_labeling_session",
    arguments: { session_id: "00000000-0000-0000-0000-000000000000" },
  });
  assert(missing.isError === true, "Expected missing session call to return isError=true.");
  const missingContent = missing.content as Array<{ type: string; text?: string }>;
  const text = missingContent
    .filter((content) => content.type === "text")
    .map((content) => content.text ?? "")
    .join("\n")
    .trim();
  assert(text.length > 0, "Tool error text is empty.");
  assert(text.length <= 240, `Tool error text is too long: ${text.length} characters.`);
  assert(!/[{}[\]]/.test(text), `Tool error text looks like raw JSON: ${text}`);
  assert(!/(stack|trace|zoderror|sqlite|internal server error|error:)/i.test(text), `Tool error text looks raw: ${text}`);
}

function healthUrlFor(url: URL): URL {
  const health = new URL(url);
  health.pathname = health.pathname.replace(/\/mcp\/?$/, "/healthz");
  if (health.pathname === url.pathname) {
    health.pathname = "/healthz";
  }
  health.search = "";
  health.hash = "";
  return health;
}

async function assertProtocolVersion(protocolVersion: "2025-03-26" | "2025-11-25"): Promise<void> {
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: {
          name: "labelbridge-deployed-endpoint-check",
          version: "0.1.0",
        },
      },
    }),
  });
  const body = (await response.json()) as {
    result?: { protocolVersion?: string; serverInfo?: { name?: string } };
    error?: { message?: string };
  };
  assert(response.ok, `Initialize ${protocolVersion} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  assert(body.result?.serverInfo?.name === "labelbridge-mcp", `Unexpected server name: ${body.result?.serverInfo?.name ?? "unknown"}`);
  assert(!restrictedNamePattern.test(body.result?.serverInfo?.name ?? ""), "Server name contains a restricted brand keyword.");
  assert(
    body.result?.protocolVersion === protocolVersion,
    `Expected protocol ${protocolVersion}, got ${body.result?.protocolVersion ?? body.error?.message ?? "unknown"}`,
  );
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url);
  assert(response.ok, `${url.toString()} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

function redactUrl(url: URL): string {
  const redacted = new URL(url);
  if (redacted.searchParams.has("cap")) {
    redacted.searchParams.set("cap", "[redacted]");
  }
  return redacted.toString();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
