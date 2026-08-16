/** Envelope every endpoint returns, success or failure. */
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  meta: ApiMeta;
}

export interface ApiError {
  /** Stable, machine-readable code — clients branch on this, not on `message`. */
  code: string;
  /** Human-readable explanation, safe to surface to an end user. */
  message: string;
  /** Structured context: which quota was exhausted, which field failed, etc. */
  details?: Record<string, unknown>;
}

export interface ApiMeta {
  timestamp: string;
  path: string;
  [key: string]: unknown;
}
