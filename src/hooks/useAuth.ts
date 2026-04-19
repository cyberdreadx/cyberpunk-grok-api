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
  is_admin?: boolean;
  is_feed_mod?: boolean;
  is_verified?: boolean;
  verification_status?: "unverified" | "pending" | "verified" | "lapsed";
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  /** When set, the UI should show the verification code input. */
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  /** When set, the UI should show the 2FA login code prompt. */
  const [pendingTwoFactorEmail, setPendingTwoFactorEmail] = useState<string | null>(null);

  // Hydrate user from stored token on mount
  useEffect(() => {
    if (!hasAuthToken()) {
      setLoading(false);
      return;
    }
    apiFetch<AuthUser & { email_verified?: boolean; is_admin?: boolean; is_feed_mod?: boolean; is_verified?: boolean; verification_status?: AuthUser["verification_status"] }>("/auth/me")
      .then((data) => {
        setUser({
          id: data.id,
          email: data.email,
          email_verified: data.email_verified,
          is_admin: data.is_admin,
          is_feed_mod: data.is_feed_mod,
          is_verified: data.is_verified,
          verification_status: data.verification_status,
        });
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
    const data = await apiFetch<{ token?: string; user?: AuthUser; email_verified?: boolean; twoFactorRequired?: boolean; email?: string }>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    if (data.twoFactorRequired) {
      setPendingTwoFactorEmail(data.email || email);
      return data;
    }
    if (data.token && data.user) {
      setAuthToken(data.token);
      setUser({ ...data.user, email_verified: data.email_verified });
      if (!data.email_verified) setPendingVerificationEmail(data.user.email);
    }
    return data;
  }, []);

  /** Submit the 2FA code received by email. */
  const verifyTwoFactor = useCallback(async (email: string, code: string, rememberDevice: boolean) => {
    const data = await apiFetch<{ token: string; user: AuthUser; email_verified: boolean }>("/auth/verify-2fa", {
      method: "POST",
      body: { email, code, rememberDevice },
      auth: false,
    });
    setAuthToken(data.token);
    setUser({ ...data.user, email_verified: data.email_verified });
    setPendingTwoFactorEmail(null);
    if (!data.email_verified) setPendingVerificationEmail(data.user.email);
    return data;
  }, []);

  const cancelTwoFactor = useCallback(() => setPendingTwoFactorEmail(null), []);

  /** Read/update 2FA setting. */
  const getTwoFactor = useCallback(async () => {
    return apiFetch<{ enabled: boolean; email_verified: boolean }>("/auth/two-factor");
  }, []);
  const setTwoFactor = useCallback(async (enabled: boolean) => {
    return apiFetch<{ enabled: boolean }>("/auth/two-factor", { method: "POST", body: { enabled } });
  }, []);

  /** Verify email with the 6-digit code. Refreshes token. */
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
    pendingTwoFactorEmail,
    signUp,
    signIn,
    signOut,
    verifyEmail,
    verifyTwoFactor,
    cancelTwoFactor,
    getTwoFactor,
    setTwoFactor,
    resendCode,
    cancelVerification,
    requestVerification,
    forgotPassword,
    resetPassword,
    deleteAccount,
  };
}
