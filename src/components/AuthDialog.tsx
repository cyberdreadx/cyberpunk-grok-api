import React, { useState, useRef, useEffect } from "react";
import { LogIn, UserPlus, LogOut, Mail, Lock, Loader2, ShieldCheck, ArrowLeft, RefreshCw, KeyRound, Trash2, AlertTriangle } from "lucide-react";
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
  onForgotPassword,
  onResetPassword,
  onDeleteAccount,
}) => {
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

  // Open dialog when verification is needed (signup, login, or "verify now" banner)
  useEffect(() => {
    if (pendingVerificationEmail) {
      setOpen(true);
    }
  }, [pendingVerificationEmail]);

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
          <span className="hidden sm:inline">LOGOUT</span>
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
          <span>LOGIN</span>
          <span className="font-mono-share text-[8px] text-primary/80 bg-primary/10 border border-primary/25 rounded px-1 py-0 leading-4 hidden sm:inline">
            10 FREE / DAY
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-md">
        {/* Show verification UI when we have a pending email */}
        {pendingVerificationEmail && onVerify ? (
          <VerificationForm
            email={pendingVerificationEmail}
            onVerify={onVerify}
            onResendCode={onResendCode}
            onBack={onCancelVerification}
            onSuccess={handleVerified}
          />
        ) : resetEmail && onForgotPassword && onResetPassword ? (
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
                      <p className="font-orbitron text-[10px] tracking-wider text-primary">10 FREE CREDITS EVERY DAY</p>
                      <p className="font-mono-share text-[10px] text-muted-foreground/70 leading-snug">
                        Free on login — no card needed. Generate images &amp; video daily.
                      </p>
                    </div>
                  </div>
                  <p className="font-rajdhani text-muted-foreground text-xs">
                    Sign in to use credits, or use your own API key for free.
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
                No account needed for BYOK mode — just enter your own xAI API key.
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

/** 6-digit verification code form. */
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
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

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
    try {
      await onVerify(email, fullCode);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Verification failed");
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
    setResendMsg(null);
    try {
      await onResendCode(email);
      setResendMsg("New code sent. Check your inbox.");
    } catch (err: any) {
      setError(err.message || "Failed to resend code");
    } finally {
      setResending(false);
    }
  };

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

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
          <p className="font-mono-share text-xs text-destructive">{error}</p>
        </div>
      )}

      {resendMsg && (
        <div className="bg-primary/10 border border-primary/30 rounded px-3 py-2">
          <p className="font-mono-share text-xs text-primary">{resendMsg}</p>
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
            disabled={resending}
            className="font-mono-share text-xs gap-1.5 text-muted-foreground hover:text-primary ml-auto"
          >
            {resending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            RESEND_CODE
          </Button>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <p className="text-[10px] font-mono-share text-muted-foreground/60 leading-relaxed">
          Code expires in 10 minutes. Check your spam folder if you don't see it.
        </p>
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

export default AuthDialog;
