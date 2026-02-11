import React, { useState, useRef, useEffect } from "react";
import { LogIn, UserPlus, LogOut, Mail, Lock, Loader2, ShieldCheck, ArrowLeft, RefreshCw } from "lucide-react";
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
  onSignUp: (email: string, password: string) => Promise<any>;
  onSignOut: () => Promise<void>;
  pendingVerificationEmail?: string | null;
  onVerify?: (email: string, code: string) => Promise<any>;
  onResendCode?: (email: string) => Promise<any>;
  onCancelVerification?: () => void;
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
}) => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Force dialog open when verification is needed
  useEffect(() => {
    if (pendingVerificationEmail) {
      setOpen(true);
    }
  }, [pendingVerificationEmail]);

  const handleSubmit = async (action: "signin" | "signup") => {
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      if (action === "signin") {
        await onSignIn(email, password);
        setOpen(false);
      } else {
        await onSignUp(email, password);
        // After signup, the hook will set pendingVerificationEmail
        // which triggers the verification UI
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
        <span className="font-mono-share text-[10px] text-primary/70 hidden sm:inline truncate max-w-[120px]">
          {userEmail}
        </span>
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
          className="font-mono-share text-xs gap-1.5 text-secondary hover:text-secondary/80"
        >
          <LogIn className="w-3 h-3" />
          LOGIN
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
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-orbitron text-sm tracking-wider neon-text-cyan">
                NEURAL_AUTH
              </DialogTitle>
              <DialogDescription className="font-rajdhani text-muted-foreground">
                Sign in to use credits, or use your own API key for free.
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
              </TabsContent>

              <TabsContent value="signup" className="space-y-3 mt-3">
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

export default AuthDialog;
