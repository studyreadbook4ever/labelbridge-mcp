import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.env.MCP_URL ?? "http://127.0.0.1:3000/mcp";
const client = new Client({ name: "labelbridge-demo-form", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(baseUrl));

try {
  await client.connect(transport);
  const created = await client.callTool({
    name: "create_labeling_session",
    arguments: {
      task_title: "생활 데이터 의미 라벨링",
      task_description: "각 항목을 보고 사람이 이해한 의미를 짧게 채웁니다.",
      items: [
        {
          id: "transfer_001",
          text: "카카오톡 나에게 보내기로 옮긴 에어컨 사진",
          hint: "전자제품",
          context: "기기 간 임시 파일 이동",
          source_app: "Messenger",
        },
        {
          id: "memo_002",
          text: "회의 녹취 중 고객 불만 요약",
          hint: "업무 메모",
          topic: "고객지원",
          source_app: "Recorder",
        },
      ],
      expires_in_minutes: 60,
    },
  });
  const structured = created.structuredContent as { form_url?: string; download_url?: string };
  if (!structured.form_url) {
    throw new Error("No form_url returned");
  }
  console.log(JSON.stringify(structured, null, 2));
} finally {
  await client.close();
}
