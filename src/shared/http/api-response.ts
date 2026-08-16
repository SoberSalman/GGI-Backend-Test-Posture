/**
 * Envelope every endpoint returns.
 *
 * A union so the pairing is enforced rather than conventional: a shape with
 * `success: boolean` and two independently nullable fields also permits
 * `{ success: true, error: {...} }`.
 */
export type ApiResponse<T> =
  | { success: true; data: T; error: null; meta: ApiMeta }
  | { success: false; data: null; error: ApiError; meta: ApiMeta };

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
