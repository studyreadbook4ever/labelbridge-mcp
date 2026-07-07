import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.argv[2] ?? process.env.MCP_ENDPOINT ?? process.env.SMOKE_MCP_URL ?? "http://127.0.0.1:3000/mcp";
const iterations = Number(process.env.LATENCY_ITERATIONS ?? 20);
const averageBudgetMs = Number(process.env.LATENCY_AVERAGE_BUDGET_MS ?? 100);
const p99BudgetMs = Number(process.env.LATENCY_P99_BUDGET_MS ?? 3000);

assert(Number.isInteger(iterations) && iterations >= 5, "LATENCY_ITERATIONS must be an integer >= 5.");

const client = new Client({ name: "labelbridge-latency-check", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(endpoint));

try {
  await client.connect(transport);
  const baselineSessionId = await createSession("Latency Baseline");

  const createDurations = await measure(iterations, (index) => createSession(`Latency Create ${index + 1}`));
  const inspectDurations = await measure(iterations, () =>
    client.callTool({
      name: "inspect_labeling_session",
      arguments: { session_id: baselineSessionId },
    }),
  );

  const createStats = stats(createDurations);
  const inspectStats = stats(inspectDurations);
  assertWithinBudget("create_labeling_session", createStats);
  assertWithinBudget("inspect_labeling_session", inspectStats);

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint,
        iterations,
        budgets_ms: {
          average: averageBudgetMs,
          p99: p99BudgetMs,
        },
        tools: {
          create_labeling_session: createStats,
          inspect_labeling_session: inspectStats,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}

async function createSession(title: string): Promise<string> {
  const result = await client.callTool({
    name: "create_labeling_session",
    arguments: {
      task_title: title,
      task_description: "Latency check with one blank-only semantic item.",
      items: [{ id: "latency_item", text: "semantic latency sample" }],
      expires_in_minutes: 5,
    },
  });
  const structured = result.structuredContent as { session_id?: string };
  assert(typeof structured.session_id === "string", "create_labeling_session did not return session_id.");
  return structured.session_id;
}

async function measure<T>(count: number, operation: (index: number) => Promise<T>): Promise<number[]> {
  const durations: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    await operation(index);
    durations.push(performance.now() - started);
  }
  return durations;
}

function stats(durations: number[]): { average_ms: number; p99_ms: number; max_ms: number; min_ms: number } {
  const sorted = [...durations].sort((a, b) => a - b);
  const average = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  const p99Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1);
  return {
    average_ms: round(average),
    p99_ms: round(sorted[p99Index] ?? 0),
    max_ms: round(sorted[sorted.length - 1] ?? 0),
    min_ms: round(sorted[0] ?? 0),
  };
}

function assertWithinBudget(toolName: string, values: { average_ms: number; p99_ms: number }): void {
  assert(values.average_ms <= averageBudgetMs, `${toolName} average ${values.average_ms}ms exceeds ${averageBudgetMs}ms.`);
  assert(values.p99_ms <= p99BudgetMs, `${toolName} p99 ${values.p99_ms}ms exceeds ${p99BudgetMs}ms.`);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
