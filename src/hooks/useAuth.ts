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
  email_verified?: boolean;
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
    apiFetch<AuthUser & { email_verified?: boolean }>("/auth/me")
      .then((data) => {
        setUser({ id: data.id, email: data.email, email_verified: data.email_verified });
      })
      .catch(() => {
        clearAuthToken();
      })
      .finally(() => setLoading(false));
  }, []);

  const signUp = useCallback(async (email: string, password: string, referralCode?: string) => {
    const body: Record<string, string> = { email, password };
    if (referralCode) body.referral_code = referralCode;
    try { body.device_fingerprint = getBrowserFingerprint(); } catch { /* non-fatal */ }
    const data = await apiFetch<{ token: string; user: AuthUser; email_verified: boolean; needsVerification: boolean }>("/auth/signup", {
      method: "POST",
      body,
      auth: false,
    });
    // Log the user in immediately (they can browse with 0 credits)
    if (data.token) {
      setAuthToken(data.token);
      setUser({ ...data.user, email_verified: data.email_verified });
    }
    // Still show verification prompt so they verify their account
    if (data.needsVerification) {
      setPendingVerificationEmail(data.user?.email ?? email);
    }
    return data;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<{ token: string; user: AuthUser; email_verified: boolean }>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    setAuthToken(data.token);
    setUser({ ...data.user, email_verified: data.email_verified });
    // If unverified, prompt for verification so they can unlock daily credits
    if (!data.email_verified) {
      setPendingVerificationEmail(data.user.email);
    }
    return data;
  }, []);

  /** Verify email with the 6-digit code. Refreshes token and grants daily credits. */
  const verifyEmail = useCallback(async (email: string, code: string) => {
    const data = await apiFetch<{ token: string; user: AuthUser }>("/auth/verify", {
      method: "POST",
      body: { email, code },
      auth: false,
    });
    setAuthToken(data.token);
    setUser({ ...data.user, email_verified: true });
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

  /** Open the verification dialog for an already-logged-in but unverified user. */
  const requestVerification = useCallback(() => {
    if (user && !user.email_verified) {
      setPendingVerificationEmail(user.email);
    }
  }, [user]);

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
    requestVerification,
    forgotPassword,
    resetPassword,
    deleteAccount,
  };
}
