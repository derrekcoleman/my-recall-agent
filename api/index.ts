import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RecallAgentToolkit } from "@recallnet/agent-toolkit/mcp";
import { randomUUID } from "node:crypto";

// Map to store transports by session ID
const transports: Record<
  string,
  {
    transport: StreamableHTTPServerTransport;
    toolkit: RecallAgentToolkit;
    lastActivity: number;
  }
> = {};

// Create a toolkit instance
const createToolkit = () => {
  const privateKey = process.env.RECALL_PRIVATE_KEY;
  const network = process.env.RECALL_NETWORK || "testnet";

  if (!privateKey) {
    throw new Error("Missing RECALL_PRIVATE_KEY environment variable");
  }

  return new RecallAgentToolkit({
    privateKey,
    configuration: {
      actions: {
        account: {
          read: true,
          write: true,
        },
        bucket: {
          read: true,
          write: true,
        },
      },
      context: {
        network,
      },
    },
  });
};

// Create the Express app
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
    credentials: true,
    exposedHeaders: [
      "Content-Type",
      "Cache-Control",
      "Connection",
      "Mcp-Session-Id",
    ],
  })
);

// Health check endpoint
app.get("/", (req: Request, res: Response) => {
  res
    .status(200)
    .json({ status: "ok", message: "Recall MCP Server is running" });
});

// Handle preflight requests
app.options("/mcp", (req: Request, res: Response) => {
  res.status(200).end();
});

// Handle POST requests for client-to-server communication
app.post("/mcp", async (req: Request, res: Response) => {
  console.log(`Handling POST request to /mcp`);

  try {
    // Check for existing session ID
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let sessionData;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      console.log(`Reusing existing session: ${sessionId}`);
      sessionData = transports[sessionId];
      sessionData.lastActivity = Date.now();
    } else {
      // Create new transport for a new session
      console.log("Creating new session transport");
      const sessionId = randomUUID();

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });

      // Create and connect toolkit
      const toolkit = createToolkit();
      console.log(`Connecting toolkit for new session ${sessionId}...`);
      await toolkit.connect(transport);
      console.log(`Toolkit connected successfully for session ${sessionId}`);

      // Store session data
      sessionData = { transport, toolkit, lastActivity: Date.now() };
      transports[sessionId] = sessionData;

      // Set session ID in response header
      res.setHeader("Mcp-Session-Id", sessionId);

      // Clean up when the transport is closed
      transport.onclose = () => {
        console.log(`Transport closed for session ${sessionId}`);
        delete transports[sessionId];
      };
    }

    // Check content type for POST requests
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

    // Set appropriate content type headers based on Accept
    const acceptHeader = req.get("Accept") || "";
    if (acceptHeader.includes("text/event-stream")) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
    } else {
      res.setHeader("Content-Type", "application/json");
    }

    console.log(`Processing request with body: ${JSON.stringify(req.body)}`);

    // Handle the request
    await sessionData.transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling POST MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Handle session-based requests (GET and DELETE)
const handleSessionRequest = async (req: Request, res: Response) => {
  const method = req.method;
  console.log(`Handling ${method} request to /mcp`);

  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Invalid or missing session ID",
        },
        id: null,
      });
    }

    const sessionData = transports[sessionId];
    sessionData.lastActivity = Date.now();

    // For DELETE requests, close the transport and remove the session
    if (method === "DELETE") {
      sessionData.transport.close();
      delete transports[sessionId];
      return res
        .status(200)
        .json({ status: "ok", message: "Session terminated" });
    }

    // For GET requests, check Accept header for SSE
    if (method === "GET") {
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

      // Set SSE headers for GET requests
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Check for Last-Event-ID for stream resumption
      const lastEventId = req.header("Last-Event-ID");
      if (lastEventId) {
        console.log(`Resuming stream from event ID: ${lastEventId}`);
      }
    }

    // Handle the request
    await sessionData.transport.handleRequest(req, res);
  } catch (error) {
    console.error(`Error handling ${req.method} MCP request:`, error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
};

// Handle GET requests for server-to-client notifications via SSE
app.get("/mcp", (req: Request, res: Response) => {
  handleSessionRequest(req, res);
});

// Handle DELETE requests for session termination
app.delete("/mcp", (req: Request, res: Response) => {
  handleSessionRequest(req, res);
});

// Session cleanup job
setInterval(() => {
  const now = Date.now();
  const sessionTimeout = 30 * 60 * 1000; // 30 minutes

  for (const [sessionId, sessionData] of Object.entries(transports)) {
    if (now - sessionData.lastActivity > sessionTimeout) {
      console.log(`Cleaning up inactive session: ${sessionId}`);
      sessionData.transport.close();
      delete transports[sessionId];
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

export default app;
