// API contract from CLAUDE.md: { success, data } | { success, error: { code, message, details? } }.
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: unknown } };

export const ok = <T>(data: T): Result<T> => ({ success: true, data });

export const fail = <T = never>(code: string, message: string, details?: unknown): Result<T> => ({
  success: false,
  error: details === undefined ? { code, message } : { code, message, details },
});
