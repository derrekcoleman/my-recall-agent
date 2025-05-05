import "dotenv/config";
import express from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RecallAgentToolkit } from "@recallnet/agent-toolkit/mcp";
import { randomUUID } from "node:crypto";
// Function to create a new toolkit instance for each request
const createToolkit = () => {
    const privateKey = process.env.RECALL_PRIVATE_KEY;
    const network = process.env.RECALL_NETWORK || "testnet";
    if (!privateKey) {
        throw new Error("Missing RECALL_PRIVATE_KEY environment variable");
    }
    const configuration = {
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
// Add CORS middleware
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Accept",
        "Cache-Control",
        "Connection",
        "X-Requested-With",
        "Authorization",
    ],
    credentials: true,
    exposedHeaders: ["Content-Type", "Cache-Control", "Connection"],
}));
// Health check endpoint
app.get("/", (req, res) => {
    res
        .status(200)
        .json({ status: "ok", message: "Recall MCP Server is running" });
});
// Handle preflight requests
app.options("/mcp", (req, res) => {
    res.status(200).end();
});
app.post("/mcp", async (req, res) => {
    try {
        // Set SSE headers if client expects SSE
        const acceptHeader = req.get("Accept") || "";
        if (acceptHeader.includes("text/event-stream")) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
        }
        const toolkit = createToolkit();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
        });
        res.on("close", () => {
            console.log("Request closed");
            transport.close();
        });
        await toolkit.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }
    catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal server error" },
                id: null,
            });
        }
    }
});
app.get("/mcp", async (req, res) => {
    try {
        // Set SSE headers for GET requests explicitly
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        const toolkit = createToolkit();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
        });
        res.on("close", () => {
            console.log("SSE connection closed");
            transport.close();
        });
        await toolkit.connect(transport);
        await transport.handleRequest(req, res);
    }
    catch (error) {
        console.error("Error handling GET MCP request:", error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal server error" },
                id: null,
            });
        }
    }
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
