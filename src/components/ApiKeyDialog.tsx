import React, { useState } from "react";
import { Key, Shield, ExternalLink, Eye, EyeOff, Trash2 } from "lucide-react";
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

interface ApiKeyDialogProps {
  hasKey: boolean;
  onSave: (key: string) => void;
  onClear: () => void;
}

const ApiKeyDialog: React.FC<ApiKeyDialogProps> = ({ hasKey, onSave, onClear }) => {
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showStored, setShowStored] = useState(false);
  const [open, setOpen] = useState(false);

  const storedKey = hasKey ? (localStorage.getItem("xai-api-key") || "") : "";

  const handleSave = () => {
    if (key.trim()) {
      onSave(key.trim());
      setKey("");
      setShowStored(false);
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`font-mono-share text-xs gap-2 ${
            hasKey
              ? "text-primary hover:text-primary/80"
              : "text-muted-foreground/60 hover:text-muted-foreground"
          }`}
        >
          {hasKey ? <Shield className="w-3 h-3" /> : <Key className="w-3 h-3" />}
          {hasKey ? "API_KEY: SET" : "SET_API_KEY"}
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-orbitron text-sm tracking-wider neon-text-cyan">
            XAI_CREDENTIALS
          </DialogTitle>
          <DialogDescription className="font-rajdhani text-muted-foreground">
            Bring your own xAI API key for free, unlimited use. Your key is stored locally in your browser only.
            <span className="block mt-1 text-secondary/80">
              Don't have a key? Switch to Credits mode — no setup needed.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {hasKey && storedKey && (
            <div className="space-y-1.5">
              <label className="font-mono-share text-[10px] text-muted-foreground/60 uppercase tracking-wider">Current Key</label>
              <div className="flex items-center gap-2 bg-input border border-border rounded px-3 py-2">
                <span className="font-mono-share text-sm text-foreground/80 flex-1 break-all">
                  {showStored ? storedKey : storedKey.slice(0, 6) + "•".repeat(Math.min(storedKey.length - 6, 20))}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground shrink-0"
                  onClick={() => setShowStored(!showStored)}
                >
                  {showStored ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="font-mono-share text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              {hasKey ? "Replace Key" : "Enter Key"}
            </label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="xai-xxxxxxxxxxxxxxxxxxxx"
                className="bg-input border-border font-mono-share text-sm pr-10"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleSave}
              disabled={!key.trim()}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/80 font-orbitron text-xs tracking-wider"
            >
              AUTHENTICATE
            </Button>
            {hasKey && (
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive/80"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>

          <a
            href="https://console.x.ai/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-mono-share text-muted-foreground hover:text-primary transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Get API key at console.x.ai
          </a>

          <div className="border-t border-border pt-3">
            <p className="text-[10px] font-mono-share text-muted-foreground/60 leading-relaxed">
⚠ Your key is stored in localStorage and proxied server-side to xAI — never sent directly from your browser.
              Clear browser data to remove it.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ApiKeyDialog;
