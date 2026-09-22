/*
[INPUT]: HTTPS MCP endpoint, raw API key, optional preview protection secret.
[OUTPUT]: Read-only protocol verification of the seven expected tools.
[POS]: Network gate before any client configuration or skill write.
[PROTOCOL]: Never expose response bodies or SDK errors; never follow cross-origin redirects with credentials.
*/
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const EXPECTED_TOOLS = Object.freeze([
  'sourcing_start', 'sourcing_continue', 'sourcing_read', 'sourcing_stop',
  'sourcing_review', 'sourcing_contact', 'sourcing_unlock_role',
]);

export class SetupVerificationError extends Error {}

export function parseOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS website origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !url.hostname) {
    throw new Error('Enter an HTTPS origin without a path, query, fragment, or username.');
  }
  return url.origin;
}

export function mcpUrl(origin) { return `${parseOrigin(origin)}/api/mcp`; }

export async function verifyConnection({ origin, key, bypass, fetchImpl = fetch }) {
  const endpoint = new URL(mcpUrl(origin));
  const headers = { Authorization: `Bearer ${key}` };
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;
  let failure = 'Could not verify the MCP connection. Check the origin and retry.';
  const safeFetch = async (input, init = {}) => {
    const destination = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
    if (destination.origin !== endpoint.origin) throw new Error('Unsafe MCP destination.');
    let response = await fetchImpl(input, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location && (/\/_vercel\/sso/i.test(location) || /vercel\.com\/sso/i.test(location))) {
        failure = 'The deployment appears protected. Use its preview protection bypass secret, or check access to the preview URL.';
      } else if (!location || new URL(location, destination).origin !== endpoint.origin) {
        failure = 'MCP redirected to another origin; no credentials were sent there.';
      } else {
        failure = 'MCP redirected unexpectedly. Check the website origin.';
      }
      throw new Error('MCP redirect refused.');
    }
    if (response.status === 401 || response.status === 403) {
      const protection = response.headers.get('x-vercel-protection-bypass') || response.headers.get('content-type')?.includes('text/html');
      failure = protection
        ? 'The deployment appears protected. Use its preview protection bypass secret, or check access to the preview URL.'
        : 'The API key was rejected. Create a key on the displayed website origin and retry.';
    }
    return response;
  };
  const client = new Client({ name: 'talent-summoner-setup', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers }, fetch: safeFetch });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name).sort();
    if (result.nextCursor || JSON.stringify(names) !== JSON.stringify([...EXPECTED_TOOLS].sort())) {
      throw new Error('tool-inventory');
    }
  } catch {
    throw new SetupVerificationError(failure === 'Could not verify the MCP connection. Check the origin and retry.'
      ? 'MCP verification failed or the seven expected tools were unavailable. Check the endpoint and retry.' : failure);
  } finally {
    try { await client.close(); } catch { /* best effort */ }
  }
}
