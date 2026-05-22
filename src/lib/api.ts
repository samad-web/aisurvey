import axios, { AxiosError } from 'axios';

// Public, anonymous client - no auth header, no auth store. The survey
// endpoints (/api/survey, /api/survey/drafts/*) accept unauthenticated
// requests and rate-limit per IP.
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: false,
});

apiClient.interceptors.response.use(
  (r) => r,
  (err: AxiosError<{ error?: string }>) => Promise.reject(err),
);

interface RequestConfig {
  headers?: Record<string, string>;
}

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) =>
    apiClient.get<T>(`/api${path}`, { params }).then((r) => r.data),
  post: <T>(path: string, body?: unknown, config?: RequestConfig) =>
    apiClient.post<T>(`/api${path}`, body, config).then((r) => r.data),
  put: <T>(path: string, body?: unknown, config?: RequestConfig) =>
    apiClient.put<T>(`/api${path}`, body, config).then((r) => r.data),
};
