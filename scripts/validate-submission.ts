import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const formDoc = "docs/PLAYMCP_FORM_VALUES.md";
const values = parseBacktickTable(readFileSync(formDoc, "utf8"));
const restrictedNamePattern = new RegExp(["ka", "kao"].join(""), "i");

const mcpServerName = required("MCP 서버 이름");
const gitDescription = required("설명");
const gitUrl = required("Git URL");
const branch = required("브랜치 / ref");
const dockerfilePath = required("Dockerfile 경로");
const imagePath = required("대표 이미지");
const mcpName = required("MCP 이름");
const mcpIdentifier = required("MCP 식별자");
const mcpDescription = required("MCP 설명");
const example1 = required("대화 예시 1");
const example2 = required("대화 예시 2");
const example3 = required("대화 예시 3");
const authMode = required("인증 방식");
const endpoint = required("MCP Endpoint");

assert(mcpServerName === "labelbridge-mcp", `Unexpected MCP server name: ${mcpServerName}`);
assert(isDnsResourceName(mcpServerName), `MCP server name is not a DNS resource name: ${mcpServerName}`);
assert(!restrictedNamePattern.test(mcpServerName), "MCP server name contains a restricted brand keyword.");

assert(gitDescription.length > 0 && chars(gitDescription) <= 500, "Git build description should be concise.");
assert(gitUrl === "https://github.com/studyreadbook4ever/labelbridge-mcp.git", `Unexpected Git URL: ${gitUrl}`);
assert(branch === "main", `Unexpected branch/ref: ${branch}`);
assert(dockerfilePath === "Dockerfile", `Unexpected Dockerfile path: ${dockerfilePath}`);
assert(statSync(resolve(dockerfilePath)).isFile(), `Dockerfile not found: ${dockerfilePath}`);
assertGitHeadExists(gitUrl, branch);

const image = readPngInfo(imagePath);
assert(image.width >= 600 && image.height >= 600, `Representative image must be at least 600x600, got ${image.width}x${image.height}.`);

assert(chars(mcpName) <= 30, `MCP name is too long: ${chars(mcpName)}/30`);
assert(/^[A-Za-z0-9]+$/.test(mcpIdentifier), `MCP identifier must be alphanumeric: ${mcpIdentifier}`);
assert(chars(mcpIdentifier) <= 16, `MCP identifier is too long: ${chars(mcpIdentifier)}/16`);
assert(chars(mcpDescription) <= 500, `MCP description is too long: ${chars(mcpDescription)}/500`);
assert(chars(example1) <= 40, `Example 1 is too long: ${chars(example1)}/40`);
assert(chars(example2) <= 40, `Example 2 is too long: ${chars(example2)}/40`);
assert(chars(example3) <= 40, `Example 3 is too long: ${chars(example3)}/40`);
assert(authMode === "인증 사용하지 않음", `Unexpected auth mode: ${authMode}`);
assert(endpoint === "https://YOUR_DEPLOYED_HOST/mcp", `Unexpected endpoint placeholder: ${endpoint}`);

const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((file) => !file.startsWith("assets/") && !file.endsWith("package-lock.json"));
for (const file of trackedFiles) {
  const text = readFileSync(file, "utf8");
  assert(!restrictedNamePattern.test(text), `Tracked file contains a restricted brand keyword: ${file}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      form_doc: formDoc,
      git_url: gitUrl,
      branch,
      mcp_server_name: mcpServerName,
      mcp_name: mcpName,
      mcp_identifier: mcpIdentifier,
      mcp_description_chars: chars(mcpDescription),
      examples_chars: [chars(example1), chars(example2), chars(example3)],
      representative_image: {
        path: imagePath,
        width: image.width,
        height: image.height,
      },
    },
    null,
    2,
  ),
);

function parseBacktickTable(markdown: string): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const match = /^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|$/.exec(line);
    if (match?.[1] && match[2]) {
      parsed.set(match[1].trim(), match[2]);
    }
  }
  return parsed;
}

function required(key: string): string {
  const value = values.get(key);
  assert(value, `Missing submission value: ${key}`);
  return value;
}

function chars(value: string): number {
  return [...value].length;
}

function isDnsResourceName(value: string): boolean {
  if (value.length > 253 || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value)) {
    return false;
  }
  return value.split(".").every((part) => part.length >= 1 && part.length <= 63 && /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(part));
}

function assertGitHeadExists(url: string, ref: string): void {
  const output = execFileSync("git", ["ls-remote", "--heads", url, ref], { encoding: "utf8" });
  assert(output.includes(`refs/heads/${ref}`), `Git ref not reachable: ${url} ${ref}`);
}

function readPngInfo(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  assert(bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a", `Representative image is not a PNG: ${path}`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
