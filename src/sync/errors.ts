import type { RpcClient } from './supabase';

/** docs/API.md §3 */
export type ErrorCode =
  | 'E_VALIDATION'
  | 'E_FORBIDDEN'
  | 'E_DEVICE_REVOKED'
  | 'E_VERSION_TOO_OLD'
  | 'E_CONFLICT'
  | 'E_RATE_LIMIT'
  | 'E_LOGIN'
  | 'E_LOCKED'
  | 'E_INTERNAL';

export type RpcResult<T> =
  { ok: true; data: T } | { ok: false; code: ErrorCode; message: string; network: boolean };

/** Calls an RPC and maps every outcome (envelope error, raised exception, network failure) to one shape. Never throws. */
export async function callRpc<T>(
  client: RpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<RpcResult<T>> {
  try {
    const { data, error } = await client.rpc(name, args);
    if (error) {
      const raised = /E_[A-Z_]+/.exec(error.message)?.[0] as ErrorCode | undefined;
      if (raised) return { ok: false, code: raised, message: error.message, network: false };
      const status = (error as { status?: number }).status;
      const network = status === undefined || status === 0 || status >= 500;
      return { ok: false, code: 'E_INTERNAL', message: error.message, network };
    }
    const env = data as { ok: boolean; data?: T; error?: { code: ErrorCode; message: string } };
    if (env.ok) return { ok: true, data: env.data as T };
    return {
      ok: false,
      code: env.error?.code ?? 'E_INTERNAL',
      message: env.error?.message ?? '',
      network: false,
    };
  } catch (e) {
    return {
      ok: false,
      code: 'E_INTERNAL',
      message: e instanceof Error ? e.message : 'network',
      network: true,
    };
  }
}

const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];
/** 5 s, 30 s, 2 min, 10 min, then every 10 min, forever. */
export const backoffMs = (attempt: number): number =>
  BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 600_000;
