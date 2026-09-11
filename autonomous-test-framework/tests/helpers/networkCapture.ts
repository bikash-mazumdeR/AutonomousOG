import { Page, Request } from '@playwright/test';

/**
 * Network capture utility for intercepting UI requests.
 */
export async function captureNetworkRequests(page: Page, urlPattern: string): Promise<Request[]> {
  const requests: Request[] = [];
  page.on('request', (req: Request) => {
    if (req.url().includes(urlPattern)) requests.push(req);
  });
  return requests;
}
