#!/usr/bin/env node
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { renderLabelingForm } from "./form-template.js";
import { createMcpServer, makeFormUrls } from "./mcp-tools.js";
import { capabilityDigest } from "./security.js";
import { LabelBridgeError, LabelBridgeStorage } from "./storage.js";

const config = loadConfig();
const storage = new LabelBridgeStorage(config.databasePath);

const app = express();
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(hostGuard);
app.use(express.json({ limit: process.env.JSON_LIMIT ?? "10mb" }));

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LabelBridge MCP</title>
  <style>
    body { margin: 0; background: #eef3f0; color: #14231f; font: 16px/1.5 system-ui, sans-serif; }
    main { width: min(860px, 100%); margin: 0 auto; padding: 40px 20px; }
    h1 { margin: 0 0 10px; font-size: 34px; letter-spacing: 0; }
    p { max-width: 72ch; color: #4f5f5a; }
    code { background: #ffffff; border: 1px solid #d8ddd6; border-radius: 6px; padding: 2px 6px; }
    .panel { margin-top: 24px; padding: 18px; background: #ffffff; border: 1px solid #d8ddd6; border-radius: 8px; }
  </style>
</head>
<body>
  <main>
    <h1>LabelBridge MCP</h1>
    <p>AI가 처리하기 애매한 의미 판단을 사람이 HTML 하나로 채우고, MCP가 그 결과를 1회용 capability로 회수해 dictionary 배열로 돌려주는 human-in-the-loop labeling bridge입니다.</p>
    <section class="panel">
      <p>MCP endpoint: <code>/mcp</code></p>
      <p>Health: <code>/healthz</code></p>
    </section>
  </main>
</body>
</html>`);
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, name: "labelbridge-mcp", version: "0.1.0" });
});

app.post("/mcp", async (req, res) => {
  const server = createMcpServer({ storage, config });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.get("/forms/:sessionId", (req, res) => {
  serveForm(req, res, false);
});

app.get("/forms/:sessionId/download", (req, res) => {
  serveForm(req, res, true);
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled HTTP error:", error);
  if (!res.headersSent) {
    res.status(500).json({ ok: false, error: "internal_server_error" });
  }
});

const httpServer = app.listen(config.port, config.host, () => {
  console.log(`LabelBridge MCP listening on http://${config.host}:${config.port}`);
  console.log(`Public base URL: ${config.publicBaseUrl}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function serveForm(req: Request, res: Response, attachment: boolean): void {
  try {
    const rawSessionId = req.params.sessionId;
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
    if (!sessionId) {
      throw new LabelBridgeError("세션 ID가 필요합니다.", "not_found");
    }
    const capabilityToken = String(req.query.cap ?? "");
    if (!capabilityToken) {
      throw new LabelBridgeError("세션 사용권이 필요합니다.", "invalid_capability");
    }
    const digest = capabilityDigest(capabilityToken, config.serverSecret);
    const { session, items } = storage.getSessionWithItems(sessionId);
    storage.assertSessionCanView(session, digest);
    storage.recordFormRendered(sessionId);
    const html = renderLabelingForm({ session, items, capabilityToken });
    const urls = makeFormUrls(config.publicBaseUrl, session, capabilityToken);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    if (attachment) {
      res.setHeader("Content-Disposition", `attachment; filename="${urls.filename}"`);
    }
    res.send(html);
  } catch (error) {
    renderFormError(error, res);
  }
}

function renderFormError(error: unknown, res: Response): void {
  const status =
    error instanceof LabelBridgeError && error.code === "not_found"
      ? 404
      : error instanceof LabelBridgeError && (error.code === "expired" || error.code === "already_consumed")
        ? 410
        : 403;
  const message = error instanceof Error ? error.message : "설문지를 열 수 없습니다.";
  res.status(status).type("html").send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LabelBridge</title>
  <style>
    body { margin: 0; background: #eef3f0; color: #14231f; font: 16px/1.5 system-ui, sans-serif; }
    main { width: min(680px, 100%); margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 28px; letter-spacing: 0; }
  </style>
</head>
<body><main><h1>설문지를 열 수 없습니다.</h1><p>${escapeHtml(message)}</p></main></body>
</html>`);
}

function methodNotAllowed(_req: Request, res: Response): void {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
}

function hostGuard(req: Request, res: Response, next: NextFunction): void {
  const allowed = (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length) {
    next();
    return;
  }
  const host = String(req.headers.host ?? "").split(":")[0]?.toLowerCase();
  if (host && allowed.includes(host)) {
    next();
    return;
  }
  res.status(403).json({ ok: false, error: "host_not_allowed" });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shutdown(): void {
  console.log("Shutting down LabelBridge MCP...");
  httpServer.close(() => {
    storage.close();
    process.exit(0);
  });
}
