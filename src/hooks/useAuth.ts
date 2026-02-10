/**
 * Authentication hook — JWT-based, calls /api/auth/* routes.
 * No Supabase dependency. Token stored in localStorage.
 */

import { useState, useEffect, useCallback } from "react";
import {
  apiFetch,
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  hasAuthToken,
  backendEnabled,
} from "@/lib/api";

export interface AuthUser {
  id: string;
  email: string;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Hydrate user from stored token on mount
  useEffect(() => {
    if (!hasAuthToken()) {
      setLoading(false);
      return;
    }
    apiFetch<AuthUser>("/auth/me")
      .then((data) => setUser({ id: data.id, email: data.email }))
      .catch(() => {
        // Token expired or invalid — clear it
        clearAuthToken();
      })
      .finally(() => setLoading(false));
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<{ token: string; user: AuthUser }>("/auth/signup", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    setAuthToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<{ token: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    setAuthToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  const signOut = useCallback(async () => {
    clearAuthToken();
    setUser(null);
  }, []);

  return {
    user,
    loading,
    enabled: backendEnabled,
    isAuthenticated: !!user,
    signUp,
    signIn,
    signOut,
  };
}
