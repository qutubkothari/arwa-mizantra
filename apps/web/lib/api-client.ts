/**
 * API Client for SAK ERP System
 * Handles all HTTP requests to the backend API
 */

import { prepareDataQualityPayload } from "./data-quality";

const DEFAULT_BROWSER_API_BASE_URL = "/api/v1";
const DEFAULT_SERVER_API_BASE_URL =
  process.env.INTERNAL_API_URL || "http://localhost:4000/api/v1";

function normalizeBaseUrl(value: string): string {
  // Trim whitespace and remove a trailing slash to avoid double slashes when joining.
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (raw && raw.trim().length > 0) {
    return normalizeBaseUrl(raw);
  }

  if (typeof window !== "undefined") {
    // Use a relative URL so the Next.js server can proxy via rewrites.
    return DEFAULT_BROWSER_API_BASE_URL;
  }

  return normalizeBaseUrl(DEFAULT_SERVER_API_BASE_URL);
}

function buildHttpErrorMessage(
  status: number,
  statusText: string,
  data: any,
): string {
  const fallback = `HTTP ${status}: ${statusText}`;

  if (data === null || data === undefined) return fallback;

  if (typeof data === "string") {
    const t = data.trim();
    if (
      /^<!doctype\s+html|^<html/i.test(t) ||
      /<title>\s*(?:502|503|504)\s+Bad Gateway/i.test(t) ||
      /<center>\s*nginx\//i.test(t)
    )
      return status >= 500
        ? "Mizantra could not complete this request because the server took too long to respond. Please retry once."
        : fallback;
    return t.length > 0 ? t : fallback;
  }

  if (typeof data === "object") {
    const message = (data as any)?.message;
    if (Array.isArray(message)) {
      const joined = message
        .map((m) => String(m || "").trim())
        .filter(Boolean)
        .join("\n");
      if (joined) return joined;
    }
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }

    // Some APIs use { error: 'Bad Request', statusCode: 400 } without a message.
    const errorText =
      typeof (data as any)?.error === "string"
        ? String((data as any).error).trim()
        : "";
    const detailText =
      typeof (data as any)?.detail === "string"
        ? String((data as any).detail).trim()
        : "";
    const hintText =
      typeof (data as any)?.hint === "string"
        ? String((data as any).hint).trim()
        : "";

    const parts = [errorText, detailText, hintText].filter(Boolean);
    if (parts.length > 0) return parts.join(" - ");

    try {
      const json = JSON.stringify(data);
      if (json && json !== "{}" && json !== "null") return json;
    } catch {
      // ignore
    }
  }

  return fallback;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface RegisterData {
  name: string;
  username: string;
  email: string;
  password: string;
  companyName: string;
}

interface LoginData {
  username: string;
  password: string;
  tenantId?: string;
  accountId?: string;
}

function masterDataGovernanceDetail(
  endpoint: string,
  method: string,
  body: unknown,
  data: any,
) {
  const payload = data?.message?.code ? data.message : data;
  if (payload?.code !== "MASTER_DATA_GOVERNANCE_REQUIRED") return null;
  let proposed_data: Record<string, unknown> = {};
  if (typeof body === "string") {
    try {
      proposed_data = JSON.parse(body);
    } catch {
      /* request body is not JSON */
    }
  }
  return {
    entity_type: payload.entity_type,
    operation:
      method === "DELETE"
        ? "DEACTIVATE"
        : method === "POST"
          ? "CREATE"
          : "UPDATE",
    target_id: endpoint.match(/\/([0-9a-f-]+)\/?$/i)?.[1] || null,
    proposed_data,
    source_endpoint: endpoint,
  };
}

interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  requiresTenantSelection?: boolean;
  message?: string;
  tenants?: Array<{
    accountId: string;
    tenantId: string;
    companyName: string;
    displayName?: string;
    username?: string;
    email?: string;
  }>;
  user?: {
    id: string;
    username?: string;
    email: string;
    firstName?: string;
    lastName?: string;
    tenantId?: string;
    isActive?: boolean;
    role?: {
      id: string;
      name: string;
      permissions?: any[];
    };
    roles?: Array<{
      role: {
        id: string;
        name: string;
        permissions?: any[];
      };
    }>;
  };
}

interface ResetPasswordRequestData {
  email: string;
}

interface ResetPasswordData {
  token: string;
  newPassword: string;
}

class ApiClient {
  private baseUrl: string;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl ?? getApiBaseUrl());
  }

  private decodeJwtPayload(token: string): any | null {
    try {
      const payload = token.split(".")[1];
      if (!payload) return null;
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(
        Math.ceil(normalized.length / 4) * 4,
        "=",
      );
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  private isTokenExpired(token: string | null, skewSeconds = 30): boolean {
    if (!token) return true;
    if (typeof window === "undefined") return false;

    const payload = this.decodeJwtPayload(token);
    if (!payload?.exp) return false;

    const expiresAtMs = Number(payload.exp) * 1000;
    return Date.now() + skewSeconds * 1000 >= expiresAtMs;
  }

  private async refreshAccessToken(): Promise<string | null> {
    if (typeof window === "undefined") return null;
    if (this.refreshInFlight) return this.refreshInFlight;

    const refreshToken = localStorage.getItem("refreshToken");
    if (!refreshToken) return null;

    this.refreshInFlight = (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        const authData = data?.data ?? data;

        if (response.ok && authData?.accessToken && authData?.refreshToken) {
          this.saveTokens(authData.accessToken, authData.refreshToken);
          return authData.accessToken as string;
        }

        this.clearTokens();
        return null;
      } catch {
        return null;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  /**
   * Make an HTTP request to the API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${endpoint}`;

      const isFormData =
        typeof FormData !== "undefined" && options.body instanceof FormData;

      const headers: Record<string, string> = {};

      if (!isFormData) {
        headers["Content-Type"] = "application/json";
      }

      // Merge existing headers
      if (options.headers) {
        const existingHeaders = options.headers as Record<string, string>;
        Object.assign(headers, existingHeaders);
      }

      const applyAuthHeader = (token: string | null) => {
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        } else {
          delete headers["Authorization"];
        }
      };

      const isAuthEndpoint = endpoint.startsWith("/auth/");
      let accessToken = this.getToken();

      if (!isAuthEndpoint && typeof window !== "undefined") {
        if (this.isTokenExpired(accessToken)) {
          accessToken = await this.refreshAccessToken();
        }

        if (!accessToken) {
          return {
            success: false,
            error: "Not authenticated",
          };
        }
      }

      // Add auth token if available
      applyAuthHeader(accessToken);

      const execute = async () => {
        const response = await fetch(url, {
          ...options,
          headers,
        });

        // Some endpoints return 204/empty body; guard JSON parsing
        const text = await response.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text || null;
        }

        return { response, data };
      };

      let { response, data } = await execute();

      // If access token expired, attempt a single refresh + retry.
      if (
        response.status === 401 &&
        !isAuthEndpoint &&
        typeof window !== "undefined"
      ) {
        const nextAccessToken = await this.refreshAccessToken();
        if (nextAccessToken) {
          applyAuthHeader(nextAccessToken);
          ({ response, data } = await execute());
        }
      }

      if (!response.ok) {
        const governance = masterDataGovernanceDetail(
          endpoint,
          String(options.method || "GET").toUpperCase(),
          options.body,
          data,
        );
        if (governance && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("master-data-governance-required", {
              detail: governance,
            }),
          );
        }
        return {
          success: false,
          error: buildHttpErrorMessage(
            response.status,
            response.statusText,
            data,
          ),
        };
      }

      return {
        success: true,
        data,
      };
    } catch (error: any) {
      console.error("API request failed:", error);
      return {
        success: false,
        error: error.message || "Network error occurred",
      };
    }
  }

  /**
   * Get JWT token from localStorage
   */
  private getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("accessToken");
  }

  /**
   * Save JWT tokens to localStorage
   */
  private saveTokens(accessToken: string, refreshToken: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
  }

  /**
   * Remove tokens from localStorage
   */
  private clearTokens(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    // Clear any cached user data to prevent tenant data leakage
    localStorage.removeItem("user");
    localStorage.removeItem("userId");
    localStorage.removeItem("tenant");
    localStorage.removeItem("tenantId");
  }

  /**
   * Register a new user and create company
   */
  async register(data: RegisterData): Promise<ApiResponse<any>> {
    const response = await this.request("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (response.success && response.data) {
      // Auto-login after registration
      const authData = response.data as any;
      if (authData.accessToken && authData.refreshToken) {
        this.saveTokens(authData.accessToken, authData.refreshToken);
      }
    }

    return response;
  }

  /**
   * Login user
   */
  async login(data: LoginData): Promise<ApiResponse<LoginResponse>> {
    // Clear any existing session data before login to prevent tenant mixing
    this.clearTokens();

    const response = await this.request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (
      response.success &&
      response.data?.accessToken &&
      response.data?.refreshToken &&
      response.data?.user
    ) {
      this.saveTokens(response.data.accessToken, response.data.refreshToken);

      // Persist user for role-based UI and employee self-service mapping
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("user", JSON.stringify(response.data.user));
          localStorage.setItem("userId", response.data.user.id);
        } catch {
          // ignore storage errors
        }
      }
    }

    return response;
  }

  /**
   * Logout user
   */
  async logout(): Promise<ApiResponse> {
    // Logout must never depend on the network. Clear the browser session before
    // waiting for the best-effort server notification so a dead/offline API
    // cannot leave the user trapped on an authenticated screen.
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), 1500)
      : null;
    const request = this.request("/auth/logout", {
      method: "POST",
      ...(controller ? { signal: controller.signal } : {}),
    });
    this.clearTokens();

    try {
      return await request;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(
    data: ResetPasswordRequestData,
  ): Promise<ApiResponse> {
    return this.request("/auth/reset-password-request", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async resetPassword(data: ResetPasswordData): Promise<ApiResponse> {
    return this.request("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * Change password (authenticated user)
   */
  async changePassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<ApiResponse> {
    return this.request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  }

  /**
   * Refresh access token
   */
  async refreshToken(): Promise<ApiResponse> {
    if (typeof window === "undefined") {
      return { success: false, error: "Cannot refresh token on server side" };
    }

    const refreshToken = localStorage.getItem("refreshToken");
    if (!refreshToken) {
      return { success: false, error: "No refresh token available" };
    }

    const response = await this.request("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });

    if (response.success && response.data) {
      const authData = response.data as any;
      this.saveTokens(authData.accessToken, authData.refreshToken);
    }

    return response;
  }

  async getCurrentUser(): Promise<LoginResponse["user"]> {
    return this.get<LoginResponse["user"]>("/auth/me");
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const token = this.getToken();
    if (!token) return false;

    if (this.isTokenExpired(token)) {
      this.clearTokens();
      return false;
    }

    return true;
  }

  /**
   * Generic GET request
   */
  async get<T = any>(
    endpoint: string,
    params?: Record<string, any>,
  ): Promise<T> {
    let url = endpoint;
    if (params) {
      const queryString = new URLSearchParams(
        Object.entries(params).reduce(
          (acc, [key, value]) => {
            if (value !== undefined && value !== null) {
              acc[key] = String(value);
            }
            return acc;
          },
          {} as Record<string, string>,
        ),
      ).toString();
      if (queryString) {
        url = `${endpoint}?${queryString}`;
      }
    }
    const response = await this.request<T>(url, { method: "GET" });
    if (!response.success) {
      throw new Error(response.error || "Request failed");
    }
    return response.data as T;
  }

  async getBlob(endpoint: string): Promise<Blob> {
    const url = `${this.baseUrl}${endpoint}`;
    let accessToken = this.getToken();
    if (typeof window !== "undefined" && this.isTokenExpired(accessToken)) {
      accessToken = await this.refreshAccessToken();
    }
    if (!accessToken) throw new Error("Not authenticated");
    const execute = (token: string) =>
      fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    let response = await execute(accessToken);
    if (response.status === 401) {
      const refreshedToken = await this.refreshAccessToken();
      if (refreshedToken) response = await execute(refreshedToken);
    }
    if (!response.ok) {
      const text = await response.text();
      let data: any = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        /* keep response text */
      }
      throw new Error(
        buildHttpErrorMessage(response.status, response.statusText, data),
      );
    }
    return response.blob();
  }

  /**
   * Generic POST request
   */
  async post<T = any>(endpoint: string, data?: any): Promise<T> {
    const payload = data
      ? prepareDataQualityPayload(endpoint, data)
      : undefined;
    const response = await this.request<T>(endpoint, {
      method: "POST",
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!response.success) {
      throw new Error(response.error || "Request failed");
    }
    return response.data as T;
  }

  /**
   * Generic multipart/form-data POST request
   */
  async postForm<T = any>(endpoint: string, formData: FormData): Promise<T> {
    const response = await this.request<T>(endpoint, {
      method: "POST",
      body: formData,
    });
    if (!response.success) {
      throw new Error(response.error || "Request failed");
    }
    return response.data as T;
  }

  /**
   * Generic PUT request
   */
  async put<T = any>(endpoint: string, data?: any): Promise<T> {
    const payload = data
      ? prepareDataQualityPayload(endpoint, data)
      : undefined;
    const response = await this.request<T>(endpoint, {
      method: "PUT",
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!response.success) {
      throw new Error(response.error || "Request failed");
    }
    return response.data as T;
  }

  async postBlob(endpoint: string, data: any): Promise<Blob> {
    const url = `${this.baseUrl}${endpoint}`;
    let accessToken = this.getToken();
    if (typeof window !== "undefined" && this.isTokenExpired(accessToken)) {
      accessToken = await this.refreshAccessToken();
    }
    if (!accessToken) throw new Error("Not authenticated");
    const execute = (token: string) =>
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });
    let response = await execute(accessToken);
    if (response.status === 401) {
      const refreshedToken = await this.refreshAccessToken();
      if (refreshedToken) response = await execute(refreshedToken);
    }
    if (!response.ok) {
      const text = await response.text();
      let detail: any = text;
      try {
        detail = text ? JSON.parse(text) : null;
      } catch {
        /* keep response text */
      }
      throw new Error(
        buildHttpErrorMessage(response.status, response.statusText, detail),
      );
    }
    return response.blob();
  }

  /**
   * Generic PATCH request
   */
  async patch<T = any>(endpoint: string, data?: any): Promise<T> {
    const payload = data
      ? prepareDataQualityPayload(endpoint, data)
      : undefined;
    const response = await this.request<T>(endpoint, {
      method: "PATCH",
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!response.success) {
      throw new Error(response.error || "Request failed");
    }
    return response.data as T;
  }

  /**
   * Generic DELETE request
   */
  async delete<T = any>(endpoint: string): Promise<T> {
    const response = await this.request<T>(endpoint, { method: "DELETE" });
    if (!response.success) {
      throw new Error(response.error || "Request failed");
    }
    return response.data as T;
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export types
export type {
  ApiResponse,
  RegisterData,
  LoginData,
  LoginResponse,
  ResetPasswordRequestData,
};
