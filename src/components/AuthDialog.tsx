import React, { useState } from "react";
import { LogIn, UserPlus, LogOut, Mail, Lock, Loader2 } from "lucide-react";
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
}

const AuthDialog: React.FC<AuthDialogProps> = ({
  isAuthenticated,
  userEmail,
  onSignIn,
  onSignUp,
  onSignOut,
}) => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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
        setSuccessMsg("Check your email to confirm your account.");
      }
      setEmail("");
      setPassword("");
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
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

export default AuthDialog;
