/**
 * "How do I actually buy XRGE?" — the step users kept getting stuck on.
 *
 * The payment dialog already had a three-line summary, but it assumed you knew
 * what a wallet, a bridge and a DEX were. Users reported not knowing how to
 * buy, and 88% of XRGE orders were abandoned before a transaction hash was ever
 * pasted, which is what being stuck at step zero looks like in the data.
 *
 * Written for someone who has never held crypto. It also says plainly that
 * paying by card is fine — a user who bounces off this and buys with a card is
 * a better outcome than one who gives up entirely, or who sends tokens on the
 * wrong network and loses them.
 */
import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink, Copy, Check, CreditCard } from "lucide-react";
import {
  XRGE_CHAIN_NAME,
  XRGE_CHAIN_ID,
  XRGE_CONTRACT,
  XRGE_DEXSCREENER_URL,
} from "@/lib/xrgePublic";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Offered as the escape hatch when the user would rather not do any of this. */
  onUseCard?: () => void;
}

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <div className="flex gap-3">
    <div className="shrink-0 w-6 h-6 rounded-full border border-primary/40 bg-primary/10 grid place-items-center font-orbitron text-[10px] text-primary">
      {n}
    </div>
    <div className="min-w-0 flex-1 space-y-1">
      <p className="font-orbitron text-[11px] tracking-wider text-foreground">{title}</p>
      <div className="font-mono-share text-[10px] text-muted-foreground/80 leading-relaxed space-y-1">
        {children}
      </div>
    </div>
  </div>
);

const A: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="text-primary underline underline-offset-2 inline-flex items-center gap-0.5"
  >
    {children}
    <ExternalLink className="w-2.5 h-2.5" />
  </a>
);

const HowToBuyXrgeDialog: React.FC<Props> = ({ open, onClose, onUseCard }) => {
  const [copied, setCopied] = React.useState(false);

  const copyContract = () => {
    navigator.clipboard.writeText(XRGE_CONTRACT).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-orbitron text-sm tracking-wider text-primary">
            HOW TO BUY $XRGE
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="font-mono-share text-[10px] text-muted-foreground/70 leading-relaxed">
            Never bought crypto before? This takes about ten minutes end to end. You
            only have to do the setup once — after that, topping up is two taps.
          </p>

          {/* The single most expensive mistake, so it goes first rather than in a
              footnote nobody reads after they've already sent. */}
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="font-mono-share text-[10px] text-amber-200/90 leading-relaxed space-y-1">
              <p className="text-amber-300">Everything must happen on {XRGE_CHAIN_NAME}.</p>
              <p>
                {XRGE_CHAIN_NAME} is a network, like choosing between two postal
                services. Sending on Ethereum, BNB Chain or anything else sends your
                tokens somewhere nobody can reach them. Check the network says{" "}
                <span className="text-amber-300">{XRGE_CHAIN_NAME}</span> (chain{" "}
                {XRGE_CHAIN_ID}) at every step.
              </p>
            </div>
          </div>

          <div className="space-y-3.5">
            <Step n={1} title="Get a wallet">
              <p>
                Install <A href="https://www.coinbase.com/wallet">Coinbase Wallet</A> or{" "}
                <A href="https://metamask.io/">MetaMask</A> — phone app or browser
                extension, either is fine. Write the recovery phrase down on paper.
                Nobody at GLTCH will ever ask you for it.
              </p>
            </Step>

            <Step n={2} title={`Put a little ETH on ${XRGE_CHAIN_NAME}`}>
              <p>
                Buy ETH inside the wallet with a card, or buy on{" "}
                <A href="https://www.coinbase.com/">Coinbase</A> and withdraw —{" "}
                <span className="text-foreground/80">
                  when it asks which network, pick {XRGE_CHAIN_NAME}
                </span>
                . Don't bridge from Ethereum unless you already hold ETH there; buying
                straight onto {XRGE_CHAIN_NAME} is cheaper and simpler.
              </p>
              <p className="text-muted-foreground/60">
                A few dollars is plenty. ETH pays the network fee — you need a little
                left over after the swap or the send will fail.
              </p>
            </Step>

            <Step n={3} title="Swap ETH for XRGE">
              <p>
                Use your wallet's built-in swap, or{" "}
                <A href={XRGE_DEXSCREENER_URL}>open the XRGE pair</A>. Paste the
                contract address so you get the real token — anyone can create a coin
                with the same name.
              </p>
              <button
                onClick={copyContract}
                className="mt-1 w-full flex items-center gap-2 rounded border border-border/40 bg-input/50 px-2 py-1.5 text-left hover:border-primary/40 transition-colors"
              >
                <span className="flex-1 truncate font-mono-share text-[9px] text-foreground/80">
                  {XRGE_CONTRACT}
                </span>
                {copied
                  ? <Check className="w-3 h-3 text-green-400 shrink-0" />
                  : <Copy className="w-3 h-3 text-muted-foreground shrink-0" />}
              </button>
            </Step>

            <Step n={4} title="Send it to your GLTCH deposit address">
              <p>
                Back in GLTCH, pick a credit pack. You'll get an amount and a deposit
                address — copy both, and send that amount of{" "}
                <span className="text-foreground/80">XRGE</span> (not ETH) from your
                wallet.
              </p>
            </Step>

            <Step n={5} title="Paste the transaction hash">
              <p>
                Once it confirms, your wallet shows a transaction hash — a long string
                starting <span className="text-foreground/80">0x</span>. Paste it into
                GLTCH and hit verify. Credits land within a minute.
              </p>
              <p className="text-muted-foreground/60">
                Sent it but closed the window? Nothing is lost. Reopen the pack, paste
                the hash, and it verifies the same way.
              </p>
            </Step>
          </div>

          {/* Crypto is a discount path, not the only path. Saying so costs one line
              and saves the users who would otherwise just leave. */}
          <div className="rounded-lg border border-border/40 bg-card/40 p-3 space-y-2">
            <p className="font-mono-share text-[10px] text-muted-foreground/80 leading-relaxed">
              Don't want to deal with any of this? Card checkout takes thirty seconds
              and gets you the same credits. XRGE is only worth it if you want the
              holder discounts and daily credit bonuses.
            </p>
            {onUseCard && (
              <Button
                onClick={() => { onClose(); onUseCard(); }}
                variant="outline"
                className="w-full font-orbitron text-[10px] tracking-wider border-primary/30 hover:bg-primary/10"
              >
                <CreditCard className="w-3.5 h-3.5 mr-2" />
                PAY BY CARD INSTEAD
              </Button>
            )}
          </div>

          <Button onClick={onClose} className="w-full font-orbitron text-xs tracking-wider">
            GOT IT
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default HowToBuyXrgeDialog;
