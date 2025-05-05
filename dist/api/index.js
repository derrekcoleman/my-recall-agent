import "dotenv/config";
import express from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RecallAgentToolkit } from "@recallnet/agent-toolkit/mcp";
import { randomUUID } from "node:crypto";
// Map to store sessions by session ID
const sessions = {};
const toolkits = {};
const lastActivity = {};
// Create a toolkit instance
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
// Create Express app
const app = express();
app.use(express.json());
app.use(cors({
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
}));
// Health check endpoint
app.get("/", (req, res) => {
    res.status(200).json({ status: "ok" });
});
// Handle preflight requests
app.options("/mcp", (req, res) => {
    res.status(200).end();
});
// Handle POST requests for client-to-server communication
app.post("/mcp", function (req, res) {
    (async function () {
        try {
            // Check for existing session ID
            const sessionId = req.headers["mcp-session-id"];
            let transport;
            if (sessionId && sessions[sessionId]) {
                // Reuse existing transport
                transport = sessions[sessionId];
                lastActivity[sessionId] = Date.now();
            }
            else {
                // Create new transport for a new session
                const newSessionId = randomUUID();
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => newSessionId,
                });
                // Create and connect toolkit
                const toolkit = createToolkit();
                await toolkit.connect(transport);
                // Store session data
                sessions[newSessionId] = transport;
                toolkits[newSessionId] = toolkit;
                lastActivity[newSessionId] = Date.now();
                // Set session ID in response header
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
            // Set appropriate content type based on Accept header
            const acceptHeader = req.get("Accept") || "";
            if (acceptHeader.includes("text/event-stream")) {
                res.setHeader("Content-Type", "text/event-stream");
                res.setHeader("Cache-Control", "no-cache");
                res.setHeader("Connection", "keep-alive");
            }
            else {
                res.setHeader("Content-Type", "application/json");
            }
            // Handle the request
            await transport.handleRequest(req, res, req.body);
        }
        catch (error) {
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
const handleSessionRequest = async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
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
    // Handle the request
    await transport.handleRequest(req, res);
};
// Handle GET requests for server-to-client notifications via SSE
app.get("/mcp", (req, res) => {
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
app.delete("/mcp", (req, res) => {
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
