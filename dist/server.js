import "dotenv/config";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RecallAgentToolkit } from "@recallnet/agent-toolkit/mcp";
import { randomUUID } from "node:crypto";
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
const privateKey = process.env.RECALL_PRIVATE_KEY;
const network = process.env.RECALL_NETWORK || "testnet";
if (!privateKey) {
    console.error("Missing RECALL_PRIVATE_KEY environment variable");
    process.exit(1);
}
// Create the toolkit with your configuration
const toolkit = new RecallAgentToolkit({
    privateKey,
    configuration,
});
const app = express();
app.use(express.json());
app.post("/mcp", async (req, res) => {
    try {
        // Create a new transport instance for each request
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
        });
        // Handle request cleanup
        res.on("close", () => {
            console.log("Request closed");
            transport.close();
        });
        // Connect the toolkit to the transport
        await toolkit.connect(transport);
        // Handle the MCP request
        await transport.handleRequest(req, res, req.body);
    }
    catch (error) {
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
app.get("/mcp", async (req, res) => {
    console.log("Received GET MCP request");
    res.writeHead(405).end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
            code: -32000,
            message: "Method not allowed.",
        },
        id: null,
    }));
});
app.delete("/mcp", async (req, res) => {
    console.log("Received DELETE MCP request");
    res.writeHead(405).end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
            code: -32000,
            message: "Method not allowed.",
        },
        id: null,
    }));
});
// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Recall MCP HTTP Server listening on port ${PORT}`);
});
