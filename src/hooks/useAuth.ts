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
import { getBrowserFingerprint } from "@/lib/fingerprint";

export interface AuthUser {
  id: string;
  email: string;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  /** When set, the UI should show the verification code input. */
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);

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

  const signUp = useCallback(async (email: string, password: string, referralCode?: string) => {
    const body: Record<string, string> = { email, password };
    if (referralCode) body.referral_code = referralCode;
    // Attach a lightweight browser fingerprint to throttle multi-account creation
    try { body.device_fingerprint = getBrowserFingerprint(); } catch { /* non-fatal */ }
    const data = await apiFetch<{ message: string; needsVerification: boolean; email: string }>("/auth/signup", {
      method: "POST",
      body,
      auth: false,
    });
    // Signup no longer returns a token — user needs to verify email first
    setPendingVerificationEmail(data.email);
    return data;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const data = await apiFetch<{ token: string; user: AuthUser }>("/auth/login", {
        method: "POST",
        body: { email, password },
        auth: false,
      });
      setAuthToken(data.token);
      setUser(data.user);
      return data;
    } catch (err: any) {
      // If the backend says this account needs verification, surface that to the UI
      if (err.message?.includes("not verified") || err.message?.includes("needsVerification")) {
        setPendingVerificationEmail(email.toLowerCase().trim());
      }
      throw err;
    }
  }, []);

  /** Verify email with the 6-digit code. On success, logs the user in. */
  const verifyEmail = useCallback(async (email: string, code: string) => {
    const data = await apiFetch<{ token: string; user: AuthUser }>("/auth/verify", {
      method: "POST",
      body: { email, code },
      auth: false,
    });
    setAuthToken(data.token);
    setUser(data.user);
    setPendingVerificationEmail(null);
    return data;
  }, []);

  /** Resend a verification code to the given email. */
  const resendCode = useCallback(async (email: string) => {
    return apiFetch<{ message: string }>("/auth/resend-code", {
      method: "POST",
      body: { email },
      auth: false,
    });
  }, []);

  /** Cancel the verification flow (go back to login/signup). */
  const cancelVerification = useCallback(() => {
    setPendingVerificationEmail(null);
  }, []);

  /** Request a password reset code. */
  const forgotPassword = useCallback(async (email: string) => {
    return apiFetch<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      body: { email },
      auth: false,
    });
  }, []);

  /** Reset password with the 6-digit code. Auto-logs the user in. */
  const resetPassword = useCallback(async (email: string, code: string, newPassword: string) => {
    const data = await apiFetch<{ token: string; user: AuthUser; message: string }>("/auth/reset-password", {
      method: "POST",
      body: { email, code, new_password: newPassword },
      auth: false,
    });
    setAuthToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  /** Delete the user's account permanently. Requires password. */
  const deleteAccount = useCallback(async (password: string) => {
    await apiFetch<{ message: string }>("/auth/delete-account", {
      method: "POST",
      body: { password },
    });
    clearAuthToken();
    setUser(null);
    setPendingVerificationEmail(null);
  }, []);

  const signOut = useCallback(async () => {
    clearAuthToken();
    setUser(null);
    setPendingVerificationEmail(null);
  }, []);

  return {
    user,
    loading,
    enabled: backendEnabled,
    isAuthenticated: !!user,
    pendingVerificationEmail,
    signUp,
    signIn,
    signOut,
    verifyEmail,
    resendCode,
    cancelVerification,
    forgotPassword,
    resetPassword,
    deleteAccount,
  };
}
