export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } => result.ok;

export const isErr = <T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } => !result.ok;

export const mapResult = <T, E, U>(
  result: Result<T, E>,
  fn: (val: T) => U,
): Result<U, E> => {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return result;
};

export const flatMapResult = <T, E, U>(
  result: Result<T, E>,
  fn: (val: T) => Result<U, E>,
): Result<U, E> => {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
};
