import { requestUrl } from 'obsidian';

/**
 * Definition of a locally-run, OpenAI-compatible AI gateway that Steward can
 * detect and offer to connect to as a custom provider.
 */
export interface LocalGatewayDefinition {
  id: '9router' | 'omniroute';
  displayName: string;
  /** OpenAI-compatible base URL, used as the custom provider's baseUrl once connected */
  baseUrl: string;
  /** Dashboard/root URL used for the detection probe and name-sniffing */
  dashboardUrl: string;
  /** Case-insensitive substrings to look for in the dashboard HTML to identify this gateway */
  signatures: string[];
}

export const LOCAL_GATEWAYS: LocalGatewayDefinition[] = [
  {
    id: '9router',
    displayName: '9Router',
    baseUrl: 'http://localhost:20128/v1',
    dashboardUrl: 'http://localhost:20128/',
    signatures: ['9router', '9 router'],
  },
  {
    id: 'omniroute',
    displayName: 'OmniRoute',
    baseUrl: 'http://localhost:20128/v1',
    dashboardUrl: 'http://localhost:20128/',
    signatures: ['omniroute', 'omni route'],
  },
];

export interface LocalGatewayScanResult {
  gateway: LocalGatewayDefinition;
}

/**
 * 9Router and OmniRoute both default to the same local port and are not meant
 * to run at the same time, so a single probe to the shared dashboard URL is
 * enough - the response body is then sniffed to tell which one answered.
 */
async function probeDashboard(url: string, timeoutMs: number): Promise<string | null> {
  const timeout = new Promise<null>(resolve => window.setTimeout(() => resolve(null), timeoutMs));

  const request = (async (): Promise<string | null> => {
    try {
      const response = await requestUrl({ url, throw: false });
      return response.text ?? '';
    } catch {
      return null;
    }
  })();

  return Promise.race([request, timeout]);
}

/**
 * Ping known local AI gateway dashboards and report which one (if any) is running.
 * Any HTTP response counts as "present" - only a network error or timeout means "not detected".
 */
export async function scanForLocalGateways(timeoutMs = 2000): Promise<LocalGatewayScanResult[]> {
  const dashboardUrls = Array.from(new Set(LOCAL_GATEWAYS.map(gateway => gateway.dashboardUrl)));

  const bodiesByUrl = new Map<string, string | null>();
  await Promise.all(
    dashboardUrls.map(async url => {
      bodiesByUrl.set(url, await probeDashboard(url, timeoutMs));
    })
  );

  const results: LocalGatewayScanResult[] = [];
  for (const gateway of LOCAL_GATEWAYS) {
    const body = bodiesByUrl.get(gateway.dashboardUrl);
    if (body === null || body === undefined) {
      continue;
    }

    const lowerBody = body.toLowerCase();
    if (gateway.signatures.some(signature => lowerBody.includes(signature))) {
      results.push({ gateway });
    }
  }

  return results;
}
