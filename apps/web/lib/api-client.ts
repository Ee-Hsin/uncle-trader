import {
  ContractValidationError,
  type BacktestRequest,
  type BacktestResponse,
  type DeployResponse,
  parseBacktestRequest,
  parseBacktestResponse,
  parseDeployResponse,
} from "./contracts";

export class ApiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiClientError";
  }
}

type Fetcher = typeof fetch;

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiClientError("The API returned a response that was not JSON.");
  }
}

export async function runBacktest(
  baseUrl: string,
  request: BacktestRequest,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<BacktestResponse> {
  const validRequest = parseBacktestRequest(request);
  let response: Response;
  try {
    response = await fetcher(endpoint(baseUrl, "/backtest"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validRequest),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiClientError("The backtest API could not be reached.");
  }
  const body = await readJson(response);
  try {
    return parseBacktestResponse(body);
  } catch (error) {
    if (!response.ok) throw new ApiClientError(`The backtest API failed with HTTP ${response.status}.`);
    if (error instanceof ContractValidationError) throw new ApiClientError(error.message);
    throw error;
  }
}

export async function deployStrategy(
  baseUrl: string,
  strategyId: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<DeployResponse> {
  if (!strategyId.trim()) throw new ApiClientError("A strategy ID is required before deployment.");
  let response: Response;
  try {
    response = await fetcher(endpoint(baseUrl, `/strategies/${encodeURIComponent(strategyId)}/deploy`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiClientError("The deployment API could not be reached.");
  }
  const body = await readJson(response);
  try {
    return parseDeployResponse(body);
  } catch (error) {
    if (!response.ok) throw new ApiClientError(`The deployment API failed with HTTP ${response.status}.`);
    if (error instanceof ContractValidationError) throw new ApiClientError(error.message);
    throw error;
  }
}
