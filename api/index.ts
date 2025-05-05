import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RecallAgentToolkit } from "@recallnet/agent-toolkit/mcp";
import { randomUUID } from "node:crypto";

const sessions: { [sessionId: string]: StreamableHTTPServerTransport } = {};
const toolkits: { [sessionId: string]: RecallAgentToolkit } = {};
const lastActivity: { [sessionId: string]: number } = {};

const createToolkit = () => {
  const privateKey = process.env.RECALL_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Missing RECALL_PRIVATE_KEY environment variable");
  }

  return new RecallAgentToolkit({
    privateKey,
    configuration: {
      actions: {
        account: { read: true, write: true },
        bucket: { read: true, write: true },
      },
      context: {
        network: process.env.RECALL_NETWORK || "testnet",
      },
    },
  });
};

// Initialize app and middleware for parsing JSON requests from external clients
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Accept",
      "Cache-Control",
      "Connection",
      "X-Requested-With",
      "Authorization",
      "Mcp-Session-Id",
      "Last-Event-ID",
    ],
    exposedHeaders: [
      "Content-Type",
      "Cache-Control",
      "Connection",
      "Mcp-Session-Id",
    ],
  })
);

app.get("/", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.options("/mcp", (req: Request, res: Response) => {
  res.status(200).end();
});

app.post("/mcp", function (req: Request, res: Response) {
  (async function () {
    try {
      // Check for existing session ID
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && sessions[sessionId]) {
        // Reuse existing transport
        transport = sessions[sessionId];
        lastActivity[sessionId] = Date.now();
      } else {
        // Create new transport for a new session
        const newSessionId = randomUUID();

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
        });

        const toolkit = createToolkit();
        await toolkit.connect(transport);

        sessions[newSessionId] = transport;
        toolkits[newSessionId] = toolkit;
        lastActivity[newSessionId] = Date.now();

        res.setHeader("Mcp-Session-Id", newSessionId);

        // Clean up when the transport is closed
        transport.onclose = () => {
          delete sessions[newSessionId];
          delete toolkits[newSessionId];
          delete lastActivity[newSessionId];
        };
      }

      // Check content type
      const contentType = req.get("Content-Type") || "";
      if (!contentType.includes("application/json")) {
        return res.status(415).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Content-Type must be application/json",
          },
          id: null,
        });
      }

      // Check for SSE preference, fallback to JSON
      const acceptHeader = req.get("Accept") || "";
      if (acceptHeader.includes("text/event-stream")) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
      } else {
        res.setHeader("Content-Type", "application/json");
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error in POST handler:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  })();
});

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions[sessionId]) {
    return res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid or missing session ID" },
      id: null,
    });
  }

  const transport = sessions[sessionId];
  lastActivity[sessionId] = Date.now();

  // For DELETE requests, close the transport and remove the session
  if (req.method === "DELETE") {
    transport.close();
    // A little defensive redundancy with transport.onclose() cleanup
    delete sessions[sessionId];
    delete toolkits[sessionId];
    delete lastActivity[sessionId];
    return res.status(200).json({ status: "ok" });
  }

  // For GET requests, check Accept header for SSE
  if (req.method === "GET") {
    const acceptHeader = req.get("Accept") || "";
    if (!acceptHeader.includes("text/event-stream")) {
      return res.status(406).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Accept header must include text/event-stream",
        },
        id: null,
      });
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
  }

  await transport.handleRequest(req, res);
};

// Handle GET requests for server-to-client notifications via SSE
app.get("/mcp", (req: Request, res: Response) => {
  handleSessionRequest(req, res).catch((error) => {
    console.error("Error in GET handler:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  });
});

// Handle DELETE requests for session termination
app.delete("/mcp", (req: Request, res: Response) => {
  handleSessionRequest(req, res).catch((error) => {
    console.error("Error in DELETE handler:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  });
});

// Session cleanup job (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes

  Object.keys(sessions).forEach((id) => {
    if (now - lastActivity[id] > timeout) {
      sessions[id].close();
      delete sessions[id];
      delete toolkits[id];
      delete lastActivity[id];
    }
  });
}, 5 * 60 * 1000);

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));

export default app;
