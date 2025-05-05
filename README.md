# Recall MCP HTTP Server

This repository contains a simple HTTP server implementation of Recall's Model Context Protocol (MCP) for deployment on hosted platforms like Vercel.

## What This Does

This server sets up a Model Context Protocol server using the HTTP transport mode from the MCP SDK. It allows LLM agents to connect to your Recall account through the standard MCP interface over HTTP rather than stdio.

## Setup Instructions

### Environment Variables

You need to set up these environment variables:

- `RECALL_PRIVATE_KEY` - Your Recall private key (starts with "0x")
- `RECALL_NETWORK` - (Optional) Network to use, defaults to "testnet"
- `PORT` - (Optional) Port for the HTTP server, defaults to 3000

### Deployment Options

#### 1. Local Development

1. Install dependencies:

   ```
   npm install
   ```

2. Create a `.env` file with:

   ```
   RECALL_PRIVATE_KEY=0xyour_private_key_here
   RECALL_NETWORK=testnet
   ```

3. Start the development server:
   ```
   npm run dev
   ```

#### 2. Deploying to Vercel

1. Fork or clone this repository

2. Install the Vercel CLI globally if you haven't already

```
   npm i -g vercel
```

2. Connect to Vercel:

```

vercel

```

3. Set environment variables in the Vercel dashboard:

- Go to your project
- Navigate to Settings > Environment Variables
- Add `RECALL_PRIVATE_KEY` with your private key value
- Add `RECALL_NETWORK` if you want to use a network other than "testnet"

4. Deploy to production:

```
vercel deploy --prod
```

### Using the Server

Once deployed, your MCP server will be available at:

- Local: `http://localhost:3000`
- Vercel: `https://your-project-name.vercel.app`

You can connect to this server using any MCP client by configuring it to use your deployed URL as the server address.

## Security Considerations

- Keep your private key secure and never commit it to your repository
- You will want to implement an authentication protocol
- Limit permissions in the configuration to only what's needed

## Troubleshooting

- Make sure your private key is valid and has sufficient tokens/credits
- Verify that the server is accessible from your client's network
- If you encounter issues with the deployment, check the logs
