import React, { useState, useRef, useEffect, useCallback } from "react";
import { LogIn, UserPlus, LogOut, Mail, Lock, Loader2, ShieldCheck, ArrowLeft, RefreshCw, KeyRound, Trash2, AlertTriangle, CheckCircle2, Clock, AlertCircle, XCircle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TwoFactorSettingsDialog from "@/components/TwoFactorSettingsDialog";

interface AuthDialogProps {
  isAuthenticated: boolean;
  userEmail?: string | null;
  onSignIn: (email: string, password: string) => Promise<any>;
  onSignUp: (email: string, password: string, referralCode?: string) => Promise<any>;
  onSignOut: () => Promise<void>;
  pendingVerificationEmail?: string | null;
  onVerify?: (email: string, code: string) => Promise<any>;
  onResendCode?: (email: string) => Promise<any>;
  onCancelVerification?: () => void;
  pendingTwoFactorEmail?: string | null;
  onVerifyTwoFactor?: (email: string, code: string, rememberDevice: boolean) => Promise<any>;
  onCancelTwoFactor?: () => void;
  onForgotPassword?: (email: string) => Promise<any>;
  onResetPassword?: (email: string, code: string, newPassword: string) => Promise<any>;
  onDeleteAccount?: (password: string) => Promise<void>;
}

const AuthDialog: React.FC<AuthDialogProps> = ({
  isAuthenticated,
  userEmail,
  onSignIn,
  onSignUp,
  onSignOut,
  pendingVerificationEmail,
  onVerify,
  onResendCode,
  onCancelVerification,
  pendingTwoFactorEmail,
  onVerifyTwoFactor,
  onCancelTwoFactor,
  onForgotPassword,
  onResetPassword,
  onDeleteAccount,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  /** When set, shows the password reset flow */
  const [resetEmail, setResetEmail] = useState<string | null>(null);

  // Read referral code from URL (?ref=CODE)
  const referralCode = React.useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("ref") || undefined;
    } catch { return undefined; }
  }, []);

  // Open dialog when verification or 2FA is needed
  useEffect(() => {
    if (pendingVerificationEmail || pendingTwoFactorEmail) {
      setOpen(true);
    }
  }, [pendingVerificationEmail, pendingTwoFactorEmail]);

  // Auto-open on referral link (only once, only if not authenticated)
  useEffect(() => {
    if (referralCode && !isAuthenticated) {
      setOpen(true);
    }
  }, [referralCode, isAuthenticated]);

  const handleSubmit = async (action: "signin" | "signup") => {
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      if (action === "signin") {
        await onSignIn(email, password);
        setOpen(false);
      } else {
        const result = await onSignUp(email, password, referralCode);
        if (result?.emailWarning) {
          setError(result.emailWarning);
        }
        // User is now logged in (even if unverified) — close dialog
        setOpen(false);
      }
      setEmail("");
      setPassword("");
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerified = () => {
    setOpen(false);
    setError(null);
    setSuccessMsg(null);
  };

  if (isAuthenticated) {
    return (
      <div className="flex items-center gap-2">
        {/* Verification dialog for authenticated but unverified users */}
        {pendingVerificationEmail && onVerify && (
          <Dialog open={!!pendingVerificationEmail} onOpenChange={(v) => { if (!v && onCancelVerification) onCancelVerification(); }}>
            <DialogContent className="bg-card border-border sm:max-w-md">
              <VerificationForm
                email={pendingVerificationEmail}
                onVerify={onVerify}
                onResendCode={onResendCode}
                onBack={onCancelVerification}
                onSuccess={handleVerified}
              />
            </DialogContent>
          </Dialog>
        )}
        <span className="font-mono-share text-[10px] text-primary/70 hidden sm:inline truncate max-w-[120px]">
          {userEmail}
        </span>
        <TwoFactorSettingsDialog />
        {onDeleteAccount && (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="font-mono-share text-xs gap-1 text-muted-foreground/40 hover:text-destructive"
                title="Account settings"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border sm:max-w-sm">
              <DeleteAccountForm onDelete={onDeleteAccount} />
            </DialogContent>
          </Dialog>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onSignOut}
          className="font-mono-share text-xs gap-1.5 text-muted-foreground hover:text-destructive"
        >
          <LogOut className="w-3 h-3" />
          <span className="hidden sm:inline">{t("auth.logout").toUpperCase()}</span>
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); setError(null); setSuccessMsg(null); }}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="font-mono-share text-xs gap-1 text-secondary hover:text-secondary/80 relative"
        >
          <LogIn className="w-3 h-3" />
          <span>{t("auth.login").toUpperCase()}</span>
          <span className="font-mono-share text-[8px] text-primary/80 bg-primary/10 border border-primary/25 rounded px-1 py-0 leading-4 hidden sm:inline">
            10 FREE / DAY
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-md">
        {/* 2FA login challenge */}
        {pendingTwoFactorEmail && onVerifyTwoFactor ? (
          <TwoFactorForm
            email={pendingTwoFactorEmail}
            onVerify={onVerifyTwoFactor}
            onCancel={() => { onCancelTwoFactor?.(); setOpen(false); }}
            onSuccess={() => setOpen(false)}
          />
        ) : pendingVerificationEmail && onVerify ? (
          <VerificationForm
            email={pendingVerificationEmail}
            onVerify={onVerify}
            onResendCode={onResendCode}
            onBack={onCancelVerification}
            onSuccess={handleVerified}
          />
        ) : resetEmail !== null && onForgotPassword && onResetPassword ? (
          <ResetPasswordForm
            email={resetEmail}
            onRequestCode={onForgotPassword}
            onReset={onResetPassword}
            onBack={() => setResetEmail(null)}
            onSuccess={() => { setResetEmail(null); setOpen(false); }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-orbitron text-sm tracking-wider neon-text-cyan">
                NEURAL_AUTH
              </DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2 mt-1">
                  <div className="flex items-center gap-2 bg-primary/10 border border-primary/25 rounded-md px-3 py-2">
                    <span className="text-base">⚡</span>
                    <div>
                      <p className="font-orbitron text-[10px] tracking-wider text-primary">{t("auth.freeCreditsDaily")}</p>
                      <p className="font-mono-share text-[10px] text-muted-foreground/70 leading-snug">
                        {t("auth.freeOnLogin")}
                      </p>
                    </div>
                  </div>
                  <p className="font-rajdhani text-muted-foreground text-xs">
                    {t("auth.signInPrompt")}
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="signin" className="mt-2">
              <TabsList className="grid w-full grid-cols-2 bg-input">
                <TabsTrigger value="signin" className="font-orbitron text-[10px] tracking-wider">
                  SIGN_IN
                </TabsTrigger>
                <TabsTrigger value="signup" className="font-orbitron text-[10px] tracking-wider">
                  REGISTER
                </TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="space-y-3 mt-3">
                <AuthForm
                  email={email}
                  password={password}
                  onEmailChange={setEmail}
                  onPasswordChange={setPassword}
                  onSubmit={() => handleSubmit("signin")}
                  loading={loading}
                  buttonLabel="AUTHENTICATE"
                  buttonIcon={<LogIn className="w-3 h-3" />}
                />
                {onForgotPassword && (
                  <button
                    type="button"
                    onClick={() => setResetEmail(email || "")}
                    className="font-mono-share text-[10px] text-muted-foreground/60 hover:text-secondary transition-colors"
                  >
                    Forgot password?
                  </button>
                )}
              </TabsContent>

              <TabsContent value="signup" className="space-y-3 mt-3">
                {referralCode && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded px-3 py-2 flex items-center gap-2">
                    <span className="text-green-400 text-sm">&#127873;</span>
                    <p className="font-mono-share text-[10px] text-green-400">
                      Referred by a friend! You'll get <span className="font-bold">3 free credits</span> after verifying your email.
                    </p>
                  </div>
                )}
                <AuthForm
                  email={email}
                  password={password}
                  onEmailChange={setEmail}
                  onPasswordChange={setPassword}
                  onSubmit={() => handleSubmit("signup")}
                  loading={loading}
                  buttonLabel="CREATE_ACCOUNT"
                  buttonIcon={<UserPlus className="w-3 h-3" />}
                />
              </TabsContent>
            </Tabs>

            {error && (
              <div className="bg-destructive/10 border border-destructive/30 rounded px-3 py-2 mt-2">
                <p className="font-mono-share text-xs text-destructive">{error}</p>
              </div>
            )}

            {successMsg && (
              <div className="bg-primary/10 border border-primary/30 rounded px-3 py-2 mt-2">
                <p className="font-mono-share text-xs text-primary">{successMsg}</p>
              </div>
            )}

            <div className="border-t border-border pt-3 mt-2">
              <p className="text-[10px] font-mono-share text-muted-foreground/60 leading-relaxed">
                {t("auth.noAccountNeeded")}
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

/** Reusable form for sign-in and sign-up tabs. */
function AuthForm({
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  loading,
  buttonLabel,
  buttonIcon,
}: {
  email: string;
  password: string;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  buttonLabel: string;
  buttonIcon: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="font-mono-share text-[10px] text-muted-foreground/60 uppercase tracking-wider flex items-center gap-1">
          <Mail className="w-3 h-3" /> Email
        </label>
        <Input
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="operator@neural.net"
          className="bg-input border-border font-mono-share text-sm"
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
      </div>
      <div className="space-y-1.5">
        <label className="font-mono-share text-[10px] text-muted-foreground/60 uppercase tracking-wider flex items-center gap-1">
          <Lock className="w-3 h-3" /> Password
        </label>
        <Input
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder="••••••••"
          className="bg-input border-border font-mono-share text-sm"
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
      </div>
      <Button
        onClick={onSubmit}
        disabled={loading || !email.trim() || !password.trim()}
        className="w-full bg-primary text-primary-foreground hover:bg-primary/80 font-orbitron text-xs tracking-wider gap-2"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : buttonIcon}
        {buttonLabel}
      </Button>
    </div>
  );
}

type VerifyStatus = "idle" | "sending" | "sent" | "expired" | "rate_limited" | "invalid" | "too_many_attempts" | "send_failed";

function classifyError(msg: string): VerifyStatus {
  const lower = msg.toLowerCase();
  if (lower.includes("expired")) return "expired";
  if (lower.includes("too many") || lower.includes("rate") || lower.includes("wait") || lower.includes("limit")) return "rate_limited";
  if (lower.includes("too many failed") || lower.includes("request a new")) return "too_many_attempts";
  if (lower.includes("send") || lower.includes("deliver")) return "send_failed";
  return "invalid";
}

const STATUS_CONFIG: Record<VerifyStatus, { icon: React.ReactNode; color: string; bg: string; border: string } | null> = {
  idle: null,
  sending: null,
  sent: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "text-primary", bg: "bg-primary/10", border: "border-primary/30" },
  expired: { icon: <Clock className="w-3.5 h-3.5" />, color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/30" },
  rate_limited: { icon: <AlertCircle className="w-3.5 h-3.5" />, color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/30" },
  invalid: { icon: <XCircle className="w-3.5 h-3.5" />, color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30" },
  too_many_attempts: { icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30" },
  send_failed: { icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30" },
};

const STATUS_MESSAGES: Record<VerifyStatus, { title: string; hint: string } | null> = {
  idle: null,
  sending: null,
  sent: { title: "Code sent successfully", hint: "Check your inbox (and spam folder) for the 6-digit code." },
  expired: { title: "Code expired", hint: "Click RESEND CODE below to get a fresh code. Codes are valid for 30 minutes." },
  rate_limited: { title: "Too many requests", hint: "Please wait a few minutes before requesting another code." },
  invalid: { title: "Incorrect code", hint: "Double-check the code from your latest email. Older codes are invalidated when you resend." },
  too_many_attempts: { title: "Code invalidated", hint: "Too many wrong attempts. Click RESEND CODE to get a new one." },
  send_failed: { title: "Email delivery failed", hint: "We couldn't deliver the email. Check your address is correct, then try resending." },
};

/** 6-digit verification code form with status-aware troubleshooting. */
function VerificationForm({
  email,
  onVerify,
  onResendCode,
  onBack,
  onSuccess,
}: {
  email: string;
  onVerify: (email: string, code: string) => Promise<any>;
  onResendCode?: (email: string) => Promise<any>;
  onBack?: () => void;
  onSuccess: () => void;
}) {
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<VerifyStatus>("idle");
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, "").slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);

    // Auto-advance to next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits are entered
    if (digit && index === 5 && newCode.every((d) => d)) {
      submitCode(newCode.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === "Enter") {
      const fullCode = code.join("");
      if (fullCode.length === 6) {
        submitCode(fullCode);
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      const newCode = pasted.split("");
      setCode(newCode);
      inputRefs.current[5]?.focus();
      submitCode(pasted);
    }
  };

  const submitCode = async (fullCode: string) => {
    setLoading(true);
    setError(null);
    setStatus("idle");
    try {
      await onVerify(email, fullCode);
      onSuccess();
    } catch (err: any) {
      const msg = err.message || "Verification failed";
      setError(msg);
      setStatus(classifyError(msg));
      setCode(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!onResendCode) return;
    setResending(true);
    setError(null);
    setStatus("sending");
    try {
      await onResendCode(email);
      setStatus("sent");
      setResendCooldown(60);
      setCode(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } catch (err: any) {
      const msg = err.message || "Failed to resend code";
      setError(msg);
      setStatus(classifyError(msg));
    } finally {
      setResending(false);
    }
  };

  const statusConfig = STATUS_CONFIG[status];
  const statusMessage = STATUS_MESSAGES[status];

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="font-orbitron text-sm tracking-wider neon-text-cyan flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          VERIFY_EMAIL
        </DialogTitle>
        <DialogDescription className="font-rajdhani text-muted-foreground">
          Enter the 6-digit code sent to{" "}
          <span className="text-primary font-mono-share">{email}</span>
        </DialogDescription>
      </DialogHeader>

      {/* 6-digit code input */}
      <div className="flex justify-center gap-2" onPaste={handlePaste}>
        {code.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            disabled={loading}
            aria-label={`Verification code digit ${i + 1}`}
            placeholder="·"
            className="w-10 h-12 text-center text-lg font-mono-share bg-input border border-border rounded
                       text-primary placeholder:text-muted-foreground/30 focus:border-primary focus:ring-1
                       focus:ring-primary/50 outline-none transition-colors disabled:opacity-50"
          />
        ))}
      </div>

      {loading && (
        <div className="flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      )}

      {/* Status-aware feedback panel */}
      {statusConfig && statusMessage && (
        <div className={`${statusConfig.bg} border ${statusConfig.border} rounded-lg px-3 py-2.5 space-y-1.5`}>
          <div className={`flex items-center gap-2 ${statusConfig.color}`}>
            {statusConfig.icon}
            <span className="font-orbitron text-[10px] tracking-wider uppercase">{statusMessage.title}</span>
          </div>
          <p className="font-mono-share text-[11px] text-muted-foreground leading-relaxed pl-5.5">
            {statusMessage.hint}
          </p>
          {error && status !== "sent" && (
            <p className="font-mono-share text-[10px] text-muted-foreground/50 pl-5.5 italic">
              {error}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-border">
        {onBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="font-mono-share text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3 h-3" />
            BACK
          </Button>
        )}
        {onResendCode && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResend}
            disabled={resending || resendCooldown > 0}
            className="font-mono-share text-xs gap-1.5 text-muted-foreground hover:text-primary ml-auto disabled:opacity-50"
          >
            {resending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {resendCooldown > 0 ? `WAIT ${resendCooldown}s` : "RESEND_CODE"}
          </Button>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <div className="space-y-1.5">
          <div className="flex items-start gap-1.5">
            <Info className="w-3 h-3 text-muted-foreground/40 mt-0.5 shrink-0" />
            <p className="text-[10px] font-mono-share text-muted-foreground/60 leading-relaxed">
              Codes expire in 30 minutes. Only the most recent code works — older codes are invalidated when you resend.
            </p>
          </div>
          <div className="flex items-start gap-1.5">
            <Mail className="w-3 h-3 text-muted-foreground/40 mt-0.5 shrink-0" />
            <p className="text-[10px] font-mono-share text-muted-foreground/60 leading-relaxed">
              Not seeing the email? Check spam/junk. The sender is <span className="text-muted-foreground/80">noreply@grokrunner.gltch.app</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Password reset flow: enter email → get code → enter code + new password. */
function ResetPasswordForm({
  email: initialEmail,
  onRequestCode,
  onReset,
  onBack,
  onSuccess,
}: {
  email: string;
  onRequestCode: (email: string) => Promise<any>;
  onReset: (email: string, code: string, newPassword: string) => Promise<any>;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<"email" | "code">(initialEmail ? "email" : "email");
  const [emailVal, setEmailVal] = useState(initialEmail);
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleRequestCode = async () => {
    setLoading(true);
    setError(null);
    try {
      await onRequestCode(emailVal);
      setSuccessMsg("If that email exists, a reset code has been sent.");
      setStep("code");
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch (err: any) {
      setError(err.message || "Failed to send reset code");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);
    if (digit && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setCode(pasted.split(""));
      inputRefs.current[5]?.focus();
    }
  };

  const handleReset = async () => {
    const fullCode = code.join("");
    if (fullCode.length !== 6 || !newPassword) return;
    setLoading(true);
    setError(null);
    try {
      await onReset(emailVal, fullCode, newPassword);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Reset failed");
      setCode(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="font-orbitron text-sm tracking-wider neon-text-magenta flex items-center gap-2">
          <KeyRound className="w-4 h-4" />
          RESET_PASSWORD
        </DialogTitle>
        <DialogDescription className="font-rajdhani text-muted-foreground">
          {step === "email"
            ? "Enter your email to receive a reset code."
            : "Enter the 6-digit code and your new password."}
        </DialogDescription>
      </DialogHeader>

      {step === "email" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="font-mono-share text-[10px] text-muted-foreground/60 uppercase tracking-wider flex items-center gap-1">
              <Mail className="w-3 h-3" /> Email
            </label>
            <Input
              type="email"
              value={emailVal}
              onChange={(e) => setEmailVal(e.target.value)}
              placeholder="operator@neural.net"
              className="bg-input border-border font-mono-share text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleRequestCode()}
            />
          </div>
          <Button
            onClick={handleRequestCode}
            disabled={loading || !emailVal.trim()}
            className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 font-orbitron text-xs tracking-wider gap-2"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
            SEND_RESET_CODE
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* 6-digit code */}
          <div className="flex justify-center gap-2" onPaste={handlePaste}>
            {code.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                disabled={loading}
                placeholder="·"
                className="w-10 h-12 text-center text-lg font-mono-share bg-input border border-border rounded
                           text-secondary placeholder:text-muted-foreground/30 focus:border-secondary focus:ring-1
                           focus:ring-secondary/50 outline-none transition-colors disabled:opacity-50"
              />
            ))}
          </div>
          {/* New password */}
          <div className="space-y-1.5">
            <label className="font-mono-share text-[10px] text-muted-foreground/60 uppercase tracking-wider flex items-center gap-1">
              <Lock className="w-3 h-3" /> New Password
            </label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="bg-input border-border font-mono-share text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleReset()}
              minLength={6}
            />
          </div>
          <Button
            onClick={handleReset}
            disabled={loading || code.join("").length !== 6 || newPassword.length < 6}
            className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 font-orbitron text-xs tracking-wider gap-2"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
            SET_NEW_PASSWORD
          </Button>
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
          <p className="font-mono-share text-xs text-destructive">{error}</p>
        </div>
      )}
      {successMsg && (
        <div className="bg-primary/10 border border-primary/30 rounded px-3 py-2">
          <p className="font-mono-share text-xs text-primary">{successMsg}</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="font-mono-share text-xs gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3 h-3" />
          BACK_TO_LOGIN
        </Button>
        {step === "code" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setStep("email"); setCode(["", "", "", "", "", ""]); setError(null); }}
            className="font-mono-share text-xs gap-1.5 text-muted-foreground hover:text-secondary"
          >
            <RefreshCw className="w-3 h-3" />
            RESEND
          </Button>
        )}
      </div>
    </div>
  );
}

/** Delete account confirmation with password input. */
function DeleteAccountForm({ onDelete }: { onDelete: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmText === "DELETE" && password.length >= 1;

  const handleDelete = async () => {
    if (!canDelete) return;
    setLoading(true);
    setError(null);
    try {
      await onDelete(password);
    } catch (err: any) {
      setError(err.message || "Failed to delete account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="font-orbitron text-sm tracking-wider text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          DELETE_ACCOUNT
        </DialogTitle>
        <DialogDescription className="font-rajdhani text-muted-foreground">
          This will permanently delete your account, all credits, and cancel any active subscription.
          <span className="text-destructive font-semibold"> This cannot be undone.</span>
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="font-mono-share text-[10px] text-muted-foreground/60 uppercase tracking-wider flex items-center gap-1">
            <Lock className="w-3 h-3" /> Confirm Password
          </label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="bg-input border-border font-mono-share text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="font-mono-share text-[10px] text-muted-foreground/60 uppercase tracking-wider">
            Type <span className="text-destructive">DELETE</span> to confirm
          </label>
          <Input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            className="bg-input border-border font-mono-share text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleDelete()}
          />
        </div>
        <Button
          onClick={handleDelete}
          disabled={loading || !canDelete}
          variant="destructive"
          className="w-full font-orbitron text-xs tracking-wider gap-2"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          PERMANENTLY_DELETE_ACCOUNT
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
          <p className="font-mono-share text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}

/** 2FA login code prompt with "remember this device" option. */
function TwoFactorForm({
  email,
  onVerify,
  onCancel,
  onSuccess,
}: {
  email: string;
  onVerify: (email: string, code: string, rememberDevice: boolean) => Promise<any>;
  onCancel?: () => void;
  onSuccess: () => void;
}) {
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (value?: string) => {
    const c = (value ?? code).trim();
    if (!/^\d{6}$/.test(c)) { setError("Enter the 6-digit code"); return; }
    setLoading(true); setError(null);
    try {
      await onVerify(email, c, remember);
      onSuccess();
    } catch (e: any) {
      setError(e?.message || "Invalid code");
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="font-orbitron text-sm tracking-wider neon-text-cyan flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> TWO_FACTOR_AUTH
        </DialogTitle>
        <DialogDescription className="font-mono-share text-xs text-muted-foreground/80">
          We sent a 6-digit code to <span className="text-secondary">{email}</span>. It expires in 10 minutes.
        </DialogDescription>
      </DialogHeader>

      <Input
        type="text"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        autoFocus
        value={code}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 6);
          setCode(v);
          if (v.length === 6) submit(v);
        }}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="000000"
        className="bg-input border-border font-mono-share text-center text-2xl tracking-[0.5em]"
      />

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="accent-primary"
        />
        <span className="font-mono-share text-[11px] text-muted-foreground">
          Remember this device for 30 days
        </span>
      </label>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
          <p className="font-mono-share text-xs text-destructive">{error}</p>
        </div>
      )}

      <div className="flex gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} className="font-orbitron text-xs gap-1.5">
            <ArrowLeft className="w-3 h-3" /> CANCEL
          </Button>
        )}
        <Button
          onClick={() => submit()}
          disabled={loading || code.length !== 6}
          className="flex-1 bg-primary text-primary-foreground hover:bg-primary/80 font-orbitron text-xs tracking-wider gap-2"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
          VERIFY
        </Button>
      </div>
    </div>
  );
}

export default AuthDialog;
