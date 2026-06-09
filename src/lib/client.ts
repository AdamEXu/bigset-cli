export interface BigSetClientOptions {
  backendUrl?: string;
  backendPort?: string;
}

export interface Column {
  name: string;
  type: string;
  description?: string;
  isPrimaryKey?: boolean;
}

export interface Dataset {
  _id: string;
  name: string;
  description?: string;
  status?: string;
  maxRowCount?: number;
  refreshCadence?: string;
  retrievalStrategy?: string;
  sourceHint?: string;
  columns?: Column[];
  rowCount?: number;
}

export interface SchemaColumn {
  name: string;
  type: string;
  retrieval_hint?: string;
  is_primary_key?: boolean;
  nullable?: boolean;
}

export interface InferredSchema {
  dataset_name: string;
  primary_key: string;
  retrieval_strategy: string;
  source_hint?: string;
  columns: SchemaColumn[];
}

export interface Row {
  _id?: string;
  data: Record<string, unknown>;
}

export class BigSetApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function defaultBackendUrl(): string {
  const port = process.env.BIGSET_BACKEND_PORT || "3501";
  return `http://127.0.0.1:${port}`;
}

function backendUrl(options: BigSetClientOptions): string {
  if (options.backendUrl) return options.backendUrl.replace(/\/+$/, "");
  if (options.backendPort) return `http://127.0.0.1:${options.backendPort}`;
  return defaultBackendUrl();
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const value = (body as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export class BigSetClient {
  private readonly baseUrl: string;

  constructor(options: BigSetClientOptions = {}) {
    this.baseUrl = backendUrl(options);
  }

  async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const parsed = await parseResponse(response);

    if (!response.ok) {
      throw new BigSetApiError(
        errorMessage(parsed, `${method} ${path} failed with HTTP ${response.status}`),
        response.status,
      );
    }

    return parsed as T;
  }

  listDatasets(): Promise<{ datasets: Dataset[] }> {
    return this.request("GET", "/cli/datasets");
  }

  createDataset(input: {
    prompt: string;
    maxRowCount: number;
    refreshCadence: string;
  }): Promise<{ dataset: Dataset; schema: InferredSchema }> {
    return this.request("POST", "/cli/datasets", input);
  }

  getDataset(datasetId: string): Promise<{ dataset: Dataset }> {
    return this.request("GET", `/cli/datasets/${encodeURIComponent(datasetId)}`);
  }

  listRows(datasetId: string): Promise<{ rows: Row[] }> {
    return this.request("GET", `/cli/datasets/${encodeURIComponent(datasetId)}/rows`);
  }

  populate(datasetId: string): Promise<{ success: boolean; runId: string }> {
    return this.request("POST", `/cli/datasets/${encodeURIComponent(datasetId)}/populate`);
  }

  stop(datasetId: string): Promise<{ success: boolean }> {
    return this.request("POST", `/cli/datasets/${encodeURIComponent(datasetId)}/stop`);
  }
}

export function explainApiError(error: unknown): string {
  if (error instanceof BigSetApiError) {
    if (error.status === 428) {
      return `${error.message}\nRun \`bigset\` and finish setup in the browser first.`;
    }
    if (error.status === 404) {
      return `${error.message}\nMake sure local BigSet is running with \`bigset\`.`;
    }
    return error.message;
  }
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return "Could not reach the local BigSet backend. Start it with `bigset` first.";
  }
  return error instanceof Error ? error.message : String(error);
}
