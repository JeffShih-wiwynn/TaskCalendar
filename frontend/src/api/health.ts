import { API_ROUTES, parseJsonResponse, resolveApiUrl } from "./base";

export type HealthResponse = {
  status: string;
  service: string;
  timestamp: string;
};

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(resolveApiUrl(API_ROUTES.health));

  if (!response.ok) {
    throw new Error(`Health check failed with ${response.status}`);
  }

  return parseJsonResponse<HealthResponse>(response);
}
