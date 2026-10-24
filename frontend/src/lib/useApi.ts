import { useQuery } from "@tanstack/react-query";
import { api, type ApiResult, type Params } from "./api";

export function useApi<T>(path: string, params?: Params, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery<ApiResult<T>>({
    queryKey: [path, params ?? {}],
    queryFn: () => api.get<T>(path, params),
    enabled: opts.enabled ?? true,
    refetchInterval: opts.refetchInterval,
  });
}
