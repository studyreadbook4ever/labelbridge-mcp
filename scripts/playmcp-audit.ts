import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.env.SMOKE_MCP_URL ?? "http://127.0.0.1:3123/mcp";
const client = new Client({ name: "labelbridge-playmcp-audit", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(baseUrl));

try {
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
