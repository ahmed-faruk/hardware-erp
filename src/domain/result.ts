export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; code: string; message: string };
export type Result<T> = Ok<T> | Err;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = (code: string, message: string): Err => ({ ok: false, code, message });
