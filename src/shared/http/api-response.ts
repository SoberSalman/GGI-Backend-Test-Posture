/** Envelope every endpoint returns, success or failure. */
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  meta: ApiMeta;
}

export interface ApiError {
  /** Clients branch on this, not on `message`. */
  code: string;
  message: string;
  /** Structured context: which quota was exhausted, which field failed, etc. */
  details?: Record<string, unknown>;
}

export interface ApiMeta {
  timestamp: string;
  path: string;
}
