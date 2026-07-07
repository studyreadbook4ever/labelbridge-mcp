import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.env.SMOKE_MCP_URL ?? "http://127.0.0.1:3123/mcp";
const client = new Client({ name: "labelbridge-playmcp-audit", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(baseUrl));

try {
  await assertProtocolVersion("2025-03-26");
  await assertProtocolVersion("2025-11-25");
  await assertForwardedBaseUrl();

  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert(tools.length >= 3 && tools.length <= 10, `PlayMCP recommends 3-10 tools; got ${tools.length}`);

  const seen = new Set<string>();
  for (const tool of tools) {
    assert(/^[A-Za-z0-9_-]{1,128}$/.test(tool.name), `Invalid tool name: ${tool.name}`);
    assert(!/kakao/i.test(tool.name), `Tool name must not contain kakao: ${tool.name}`);
    assert(!seen.has(tool.name), `Duplicate tool name: ${tool.name}`);
    seen.add(tool.name);

    assert(Boolean(tool.description), `${tool.name} is missing description`);
    assert(tool.description!.length <= 1024, `${tool.name} description is too long`);
    assert(tool.description!.includes("LabelBridge"), `${tool.name} description must include LabelBridge`);
    assert(tool.description!.includes("레이블브릿지"), `${tool.name} description must include 레이블브릿지`);
    assert(Boolean(tool.inputSchema), `${tool.name} is missing inputSchema`);

    const annotations = tool.annotations as Record<string, unknown> | undefined;
    assert(Boolean(annotations), `${tool.name} is missing annotations`);
    for (const key of ["title", "readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"]) {
      assert(annotations![key] !== undefined, `${tool.name} annotation missing ${key}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint: baseUrl,
        forwarded_url_inference: true,
        tool_count: tools.length,
        tools: tools.map((tool) => tool.name),
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertProtocolVersion(protocolVersion: "2025-03-26" | "2025-11-25"): Promise<void> {
  const response = await fetch(baseUrl, {
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
          name: "labelbridge-playmcp-audit",
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
  assert(!/kakao/i.test(body.result?.serverInfo?.name ?? ""), `Server name must not contain kakao`);
  assert(
    body.result?.protocolVersion === protocolVersion,
    `Expected protocol ${protocolVersion}, got ${body.result?.protocolVersion ?? body.error?.message ?? "unknown"}`,
  );
}

async function assertForwardedBaseUrl(): Promise<void> {
  const forwardedHost = "labelbridge.example.playmcp.dev";
  const forwardedClient = new Client({ name: "labelbridge-forwarded-url-audit", version: "0.1.0" });
  const forwardedTransport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": forwardedHost,
      },
    },
  });

  try {
    await forwardedClient.connect(forwardedTransport);
    const created = await forwardedClient.callTool({
      name: "create_labeling_session",
      arguments: {
        task_title: "Forwarded URL Audit",
        task_description: "Check that PlayMCP-style proxy headers become public form URLs.",
        items: [{ id: "forwarded", text: "semantic item" }],
        expires_in_minutes: 5,
      },
    });
    const structured = created.structuredContent as { form_url?: string };
    assert(
      typeof structured.form_url === "string" && structured.form_url.startsWith(`https://${forwardedHost}/forms/`),
      `Expected forwarded form_url, got ${structured.form_url ?? "missing"}`,
    );
  } finally {
    await forwardedClient.close();
  }
}
