import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from './api';
import type { Store } from '../types';

export function useSession() { return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot); }
export function usePermissions() {
  const session = useSession();
  const store = useApi<Store>('/store');
  const role = store.data?.role ?? session.stores.find((item) => item.id === session.tenantId)?.role ?? 'viewer';
  return { role, write: role !== 'viewer', admin: ['owner', 'admin'].includes(role), owner: role === 'owner' };
}
export function useApi<T>(path: string, enabled = true) {
  const session = useSession();
  return useQuery({
    queryKey: ['store-data', session.mode, session.tenantId, path],
    queryFn: ({ signal }) => client.request<T>(path, { signal }),
    enabled, staleTime: 30_000, retry: false, refetchOnWindowFocus: false,
  });
}
export function useStore() {
  const session = useSession();
  const query = useApi<Store>('/store');
  return query.data ?? session.stores.find((store) => store.id === session.tenantId)!;
}
export function useAllApi<T>(resource: string, enabled = true) {
  const session = useSession();
  return useInfiniteQuery({
    queryKey: ['store-data', session.mode, session.tenantId, 'picker', resource],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => client.request<{ data: T[]; total?: number }>(`${resource}${resource.includes('?') ? '&' : '?'}limit=100&page=${pageParam}`, { signal }),
    getNextPageParam: (last, pages) => (last.total !== undefined ? pages.reduce((sum, p) => sum + p.data.length, 0) < last.total : last.data.length === 100) ? pages.length + 1 : undefined,
    enabled, staleTime: 30_000, retry: false, refetchOnWindowFocus: false,
  });
}
interface Toast { id: number; message: string; kind: 'success' | 'error'; }
const ToastContext = createContext<(message: string, kind?: Toast['kind']) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items.slice(-2), { id, message, kind }]);
    setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 5000);
  }, []);
  return <ToastContext.Provider value={notify}>{children}<div className="toast-stack" aria-live="polite" aria-atomic="false">
    {toasts.map((toast) => <div key={toast.id} className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <span className="toast-dot" />{toast.message}<button aria-label="Dismiss notification" onClick={() => setToasts((rows) => rows.filter((row) => row.id !== toast.id))}>×</button>
    </div>)}
  </div></ToastContext.Provider>;
}
export const useToast = () => useContext(ToastContext);
export function useAction<T = unknown>(success = 'Changes saved.') {
  const queryClient = useQueryClient(), notify = useToast(), session = useSession();
  return useMutation({
    mutationFn: ({ path, method = 'POST', body, headers }: { path: string; method?: string; body?: unknown; headers?: Record<string, string> }) => client.request<T>(path, { method, body, headers }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['store-data', session.mode, session.tenantId] });
      notify(success);
    },
    onError: (error) => notify(error.message, 'error'),
  });
}
