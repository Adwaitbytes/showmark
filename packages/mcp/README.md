# @showmark/mcp

A read-only MCP server for Showmark on QIE. Agents can ask about verified reach, campaigns, events, passports and on-chain presence, and every transaction comes with an explorer link.

Tools: `showmark_traction`, `showmark_list_events`, `showmark_get_event`, `showmark_get_campaign`, `showmark_verified_reach`, `showmark_get_passport`, `showmark_has_attended`.

Hosted:

```bash
claude mcp add --transport http showmark https://<site>/api/mcp
```

Local over stdio:

```bash
claude mcp add showmark --env SHOWMARK_API_URL=https://<site> --env SHOWMARK_REGISTRY_ADDRESS=0x... -- node dist/cli.js
```

Local over HTTP: `node dist/cli.js --http --port 3333` serves `http://127.0.0.1:3333/mcp`.

Environment: `SHOWMARK_API_URL`, `SHOWMARK_CHAIN_ID` (1990 or 1983), `SHOWMARK_REGISTRY_ADDRESS`, `SHOWMARK_VAULT_ADDRESS`, `SHOWMARK_LENS_ADDRESS`, `SHOWMARK_RPC_URL`. All are optional; a tool that needs a missing one says what to set.

Embed it: `createShowmarkMcpServer(options)` returns the server, and `handleMcpRequest(request, options)` answers one stateless Streamable HTTP request on any runtime with `Request` and `Response`. Full setup is in `docs/SDK.md` in the Showmark repository.
