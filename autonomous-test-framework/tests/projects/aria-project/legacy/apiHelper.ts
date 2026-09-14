import { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * API Helper for common Playwright request operations.
 */
export async function performRequest(
  request: APIRequestContext,
  method: string,
  url: string,
  options: Record<string, any> = {}
): Promise<APIResponse> {
  const response = await (request as any)[method.toLowerCase()](url, options);
  return response;
}
