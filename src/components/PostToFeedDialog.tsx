import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Send, Loader2, ShieldAlert, Lock } from "lucide-react";

export interface PostToFeedValues {
  caption: string;
  isMature: boolean;
  lockCost: number;
  lockPriceCents: number;
  lockXrgeAmount: string;
}

interface PostToFeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCaption?: string;
  posting?: boolean;
  onSubmit: (values: PostToFeedValues) => Promise<void> | void;
}

const PostToFeedDialog: React.FC<PostToFeedDialogProps> = ({
  open,
  onOpenChange,
  defaultCaption = "",
  posting = false,
  onSubmit,
}) => {
  const [caption, setCaption] = useState(defaultCaption);
  const [isMature, setIsMature] = useState(false);
  const [enableLock, setEnableLock] = useState(false);
  const [lockCost, setLockCost] = useState<string>("");
  const [lockPriceCents, setLockPriceCents] = useState<string>("");
  const [lockXrgeAmount, setLockXrgeAmount] = useState<string>("");

  useEffect(() => {
    if (open) {
      setCaption(defaultCaption);
      setIsMature(false);
      setEnableLock(false);
      setLockCost("");
      setLockPriceCents("");
      setLockXrgeAmount("");
    }
  }, [open, defaultCaption]);

  const handleSubmit = async () => {
    await onSubmit({
      caption: caption.trim(),
      isMature,
      lockCost: enableLock ? Math.max(0, parseInt(lockCost) || 0) : 0,
      lockPriceCents: enableLock ? Math.max(0, Math.round(parseFloat(lockPriceCents) * 100) || 0) : 0,
      lockXrgeAmount: enableLock ? lockXrgeAmount.trim() : "",
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !posting && onOpenChange(v)}>
      <DialogContent className="max-w-md border-secondary/40 bg-background/95 backdrop-blur">
        <DialogHeader>
          <DialogTitle className="font-orbitron tracking-wider text-secondary flex items-center gap-2">
            <Send className="w-4 h-4" /> Post to Feed
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Configure your post before sharing it with the community.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Caption */}
          <div className="space-y-1.5">
            <Label htmlFor="ptf-caption" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Caption
            </Label>
            <Textarea
              id="ptf-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, 2000))}
              placeholder="Write a caption..."
              rows={3}
              className="resize-none border-border/50 bg-muted/20 text-sm"
            />
            <div className="text-[10px] text-muted-foreground/60 text-right">{caption.length}/2000</div>
          </div>

          {/* Mature toggle */}
          <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/10 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-orange-400" />
              <div>
                <Label htmlFor="ptf-mature" className="text-xs font-medium cursor-pointer">
                  Mature content
                </Label>
                <p className="text-[10px] text-muted-foreground">Blur preview for sensitive viewers.</p>
              </div>
            </div>
            <Switch id="ptf-mature" checked={isMature} onCheckedChange={setIsMature} />
          </div>

          {/* Lock toggle */}
          <div className="rounded-md border border-border/40 bg-muted/10 px-3 py-2.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-secondary" />
                <div>
                  <Label htmlFor="ptf-lock" className="text-xs font-medium cursor-pointer">
                    Lock post (paywall)
                  </Label>
                  <p className="text-[10px] text-muted-foreground">Charge to view. Verification required.</p>
                </div>
              </div>
              <Switch id="ptf-lock" checked={enableLock} onCheckedChange={setEnableLock} />
            </div>

            {enableLock && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Credits</Label>
                  <Input
                    type="number"
                    min={0}
                    value={lockCost}
                    onChange={(e) => setLockCost(e.target.value)}
                    placeholder="0"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">USD</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.50"
                    value={lockPriceCents}
                    onChange={(e) => setLockPriceCents(e.target.value)}
                    placeholder="0.00"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">XRGE</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={lockXrgeAmount}
                    onChange={(e) => setLockXrgeAmount(e.target.value)}
                    placeholder="0"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={posting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={posting} className="gap-1.5">
            {posting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Posting...
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" /> Post
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PostToFeedDialog;
