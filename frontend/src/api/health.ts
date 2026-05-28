import { API_ROUTES, requestJson } from "./base";

export type HealthResponse = {
  status: string;
  service: string;
  timestamp: string;
};

export async function getHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>(API_ROUTES.health, {}, {
    includeContentType: false,
    readErrorMessage: async (response) =>
      `Health check failed with ${response.status}`,
  });
}
