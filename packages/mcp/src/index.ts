import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveDaemonBaseUrl } from './daemon.js';
import { registerManagerTools } from './manager/index.js';
import { registerTesterTools } from './tester/index.js';

export type McpRole = 'manager' | 'tester';

export async function runMcp(role: McpRole): Promise<void> {
  const baseUrl = await resolveDaemonBaseUrl();

  const server = new McpServer({
    name: `openuser-${role}`,
    version: '0.0.1',
  });

  if (role === 'manager') {
    registerManagerTools(server, { baseUrl });
  } else {
    registerTesterTools(server, baseUrl);
  }

  const transport = new StdioServerTransport();
  // The process stays alive via the stdio transport — lifetime is transport-driven,
  // not promise-driven. Do not add await-and-exit logic after this line.
  await server.connect(transport);
}
