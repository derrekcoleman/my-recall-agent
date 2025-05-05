import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RecallAgentToolkit } from "@recallnet/agent-toolkit/mcp";
import { randomUUID } from "node:crypto";

type Configuration = {
  actions: {
    account?: {
      read?: boolean;
      write?: boolean;
    };
    bucket?: {
      read?: boolean;
      write?: boolean;
    };
  };
  context?: {
    network?: string;
    [key: string]: unknown;
  };
};

// Function to create a new toolkit instance for each request
const createToolkit = () => {
  const privateKey = process.env.RECALL_PRIVATE_KEY;
  const network = process.env.RECALL_NETWORK || "testnet";

  if (!privateKey) {
    throw new Error("Missing RECALL_PRIVATE_KEY environment variable");
  }

  const configuration: Configuration = {
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
  };

  return new RecallAgentToolkit({
    privateKey,
    configuration,
  });
};

const app = express();
app.use(express.json());

// Add CORS middleware with specific configuration
app.use(
  cors({
    origin: [
      "https://playground.ai.cloudflare.com",
      "https://claude.ai",
      "https://claude.app",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
    credentials: true,
  })
);

// Add a basic root endpoint for health check
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    message: "Recall MCP Server is running",
    endpoints: ["/mcp"],
  });
});

// Add explicit handling for preflight requests
app.options("/mcp", (req: Request, res: Response) => {
  res.status(200).end();
});

app.post("/mcp", async (req: Request, res: Response) => {
  try {
    // Create a new toolkit and transport instance for each request
    const toolkit = createToolkit();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    // Handle request cleanup
    res.on("close", () => {
      console.log("Request closed");
      transport.close();
      // No explicit toolkit close method needed
    });

    // Connect the toolkit to the transport
    await toolkit.connect(transport);

    // Handle the MCP request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
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

app.get("/mcp", async (req: Request, res: Response) => {
  console.log("Received GET MCP request");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

app.delete("/mcp", async (req: Request, res: Response) => {
  console.log("Received DELETE MCP request");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

// For local development
if (process.env.NODE_ENV !== "production") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

// Export the Express API for serverless deployment
export default app;
