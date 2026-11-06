// The remote MCP servers the office relays for a worker (see RemoteMcp), in each agent's own config.
// The bearer is always the worker's hook token, read from its environment where the agent can, so a
// provider that gets a new token every run (rotateToken) never starts with an old one.
import type { RemoteMcp } from './types.js';

const BEARER_ENV = 'AGENT_OFFICE_HOOK_TOKEN';

/**
 * Claude Code's --mcp-config for them, inline (it takes JSON as well as files). Claude Code expands
 * ${VAR} in an MCP server's url and headers, so the token stays out of the command line.
 */
export function claudeRemoteMcp(servers: RemoteMcp[]): string | undefined {
  if (!servers.length) return undefined;
  const mcpServers = Object.fromEntries(servers.map((s) => [s.name, { type: 'http', url: s.url, headers: { Authorization: `Bearer \${${BEARER_ENV}}` } }]));
  return JSON.stringify({ mcpServers });
}

/** Codex's -c overrides for them: Streamable HTTP, with the token read from the environment. */
export function codexRemoteMcpArgs(servers: RemoteMcp[]): string[] {
  // TOML basic strings read JSON's.
  return servers.flatMap((s) => ['-c', `mcp_servers.${s.name}.url=${JSON.stringify(s.url)}`, '-c', `mcp_servers.${s.name}.bearer_token_env_var=${JSON.stringify(BEARER_ENV)}`]);
}

/** OpenCode's `mcp` entries for them, made once its environment (and so its token) is final. */
export function openCodeRemoteMcp(servers: RemoteMcp[], env: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(servers.map((s) => [s.name, { type: 'remote', url: s.url, headers: { Authorization: `Bearer ${env[BEARER_ENV] ?? ''}` }, enabled: true }]));
}
