import type { components } from "./schema.gen";

export type ApiError = components["schemas"]["Error"];

// Adapts the never-throw `{ data, error }` shape every features/<domain>/api.ts
// returns into the throw-on-error contract TanStack Query's queryFn expects: a
// truthy `error` is thrown as the typed ApiError (so `useQuery().error` is that
// type), otherwise the non-null `data` is returned. The client.ts middleware
// guarantees a non-2xx always carries a structured error body and a 2xx always
// has `data`, so exactly one branch fires. Reused by every query factory.
export function unwrap<T>(result: { data: T | null; error: ApiError | null }): T {
    if (result.error) throw result.error;
    return result.data as T;
}
