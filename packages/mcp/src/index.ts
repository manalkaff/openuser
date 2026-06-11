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
  await server.connect(transport);
}
