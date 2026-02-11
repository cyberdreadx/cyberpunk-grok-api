import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, Eye } from "lucide-react";

type LegalType = "tos" | "privacy";

interface LegalDialogProps {
  type: LegalType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function TosContent() {
  return (
    <div className="space-y-5 font-rajdhani text-sm text-foreground/80 leading-relaxed">
      <p className="font-mono-share text-xs text-primary/60 border border-primary/20 rounded p-3 bg-primary/5">
        <span className="text-primary">$</span> cat /sys/legal/terms_of_service.dat
        <br />
        <span className="text-muted-foreground/40">
          {"// Last updated: 2026.02.10 // Protocol v2.0"}
        </span>
      </p>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          1. NEURAL_CONTRACT_ACCEPTANCE
        </h3>
        <p>
          By jacking into Grok Runner, you agree to be bound by this neural
          contract. If you do not accept these terms, disconnect immediately and
          clear your browser cache. Continued use of this interface constitutes
          full acceptance of all protocols outlined below.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          2. SERVICE_DESCRIPTION
        </h3>
        <p>
          Grok Runner provides a cyberpunk-themed frontend interface for xAI
          image and video generation APIs. We act as a relay node between your
          terminal and xAI neural networks. The actual generation is performed by
          xAI infrastructure - we just make it look cooler.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          3. OPERATOR_ELIGIBILITY
        </h3>
        <p>
          You must be at least 18 solar rotations old to operate this platform.
          By using Grok Runner, you confirm you have reached legal adulthood in
          your jurisdiction. We reserve the right to terminate accounts suspected
          of being operated by minors.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          4. ACCEPTABLE_USE_POLICY
        </h3>
        <p>You agree NOT to use Grok Runner to:</p>
        <ul className="list-none space-y-1 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-primary/40 mr-2">//</span>Generate illegal,
            harmful, or exploitative content
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>Attempt to bypass
            xAI safety filters or content policies
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>Reverse-engineer,
            scrape, or overload our relay infrastructure
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>Impersonate other
            users or create fraudulent accounts
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>Use automated bots
            or scripts to spam generation requests
          </li>
        </ul>
        <p className="mt-2">
          Violations may result in immediate account termination and forfeiture
          of remaining credits. No refunds will be issued for accounts terminated
          due to policy violations.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          5. CREDITS_AND_PAYMENTS
        </h3>
        <p>
          Credits are a virtual currency used to pay for generations through our
          relay. Credits are non-refundable, non-transferable, and have no
          real-world cash value. Subscription credits reset each billing cycle
          and do not roll over. Credit packs do not expire. We reserve the right
          to adjust credit costs as API pricing changes.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          6. SUBSCRIPTION_CANCELLATION
        </h3>
        <p>
          You may cancel your subscription at any time through the billing portal
          (Manage subscription / Cancel subscription button in the CREDIT_STORE).
          Cancellation takes effect at the end of your current billing period.
          Until then, you retain access to your subscription credits. No pro rata
          refunds are offered for partial months. Once cancelled, you will not be
          charged again, and your subscription credits will stop replenishing.
          Pack credits (one-time purchases) are unaffected and never expire.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          7. CONTENT_OWNERSHIP
        </h3>
        <p>
          Generated content is subject to xAI terms of service and usage
          policies. We do not claim ownership of your prompts or generated
          outputs. Generated content is stored locally in your browser
          (IndexedDB) - we do not store your images or videos on our servers.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          7. BYOK_MODE_DISCLAIMER
        </h3>
        <p>
          When using Bring Your Own Key (BYOK) mode, your xAI API key is stored
          exclusively in your browser localStorage. We never transmit, log, or
          store your API key on our servers. You are solely responsible for any
          charges incurred on your xAI account.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          8. NO_WARRANTIES
        </h3>
        <p>
          Grok Runner is provided AS IS with no warranties of any kind. We do
          not guarantee uptime, generation quality, or that the service will meet
          your specific needs. xAI may change their APIs at any time, which could
          affect functionality. We are not liable for any damages arising from
          the use of this platform.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          9. ACCOUNT_TERMINATION
        </h3>
        <p>
          We may suspend or terminate your account at any time for violations of
          these terms or for any reason at our discretion. You may delete your
          account by contacting us. Upon termination, any remaining credits are
          forfeited.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          10. MODIFICATIONS
        </h3>
        <p>
          We reserve the right to update these terms at any time. Continued use
          of Grok Runner after changes constitutes acceptance of the updated
          terms. Major changes will be announced via the platform interface.
        </p>
      </section>

      <p className="font-mono-share text-[10px] text-muted-foreground/30 pt-2 border-t border-border/30">
        {"EOF // end_of_neural_contract.dat"}
      </p>
    </div>
  );
}

function PrivacyContent() {
  const arrow = ">>";
  return (
    <div className="space-y-5 font-rajdhani text-sm text-foreground/80 leading-relaxed">
      <p className="font-mono-share text-xs text-secondary/60 border border-secondary/20 rounded p-3 bg-secondary/5">
        <span className="text-secondary">$</span> cat /sys/legal/privacy_protocol.dat
        <br />
        <span className="text-muted-foreground/40">
          {"// Last updated: 2026.02.10 // Encryption: AES-256"}
        </span>
      </p>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          1. DATA_COLLECTION
        </h3>
        <p>
          We believe in minimal data harvesting. Here is exactly what we collect:
        </p>
        <ul className="list-none space-y-1 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Email address</strong> - for
            account creation and verification
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Password hash</strong> -
            bcrypt-hashed, we never see your raw password
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Usage logs</strong> -
            generation type, credit costs, timestamps (no prompt content)
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Payment data</strong> -
            processed entirely by Stripe; we only store transaction IDs
          </li>
        </ul>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          2. CLIENT_SIDE_STORAGE
        </h3>
        <p>
          The following data lives exclusively in your browser and never touches
          our servers:
        </p>
        <ul className="list-none space-y-1 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Generated images and videos</strong>
            {" "}- stored in IndexedDB
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Folder structure and PIN hashes</strong>
            {" "}- stored in IndexedDB and localStorage
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Generation settings and prompt history</strong>
            {" "}- stored in localStorage
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">xAI API key (BYOK mode)</strong>
            {" "}- stored in localStorage, never transmitted to us
          </li>
        </ul>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          3. DATA_WE_DO_NOT_COLLECT
        </h3>
        <p>To be crystal clear, we do NOT collect or store:</p>
        <ul className="list-none space-y-1 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-primary/40 mr-2">!!</span>Your prompts or
            generated content
          </li>
          <li>
            <span className="text-primary/40 mr-2">!!</span>Your IP address
            (beyond rate-limiting windows)
          </li>
          <li>
            <span className="text-primary/40 mr-2">!!</span>Tracking cookies or
            analytics fingerprints
          </li>
          <li>
            <span className="text-primary/40 mr-2">!!</span>Any data sold to
            third parties - ever
          </li>
        </ul>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          4. THIRD_PARTY_SERVICES
        </h3>
        <p>
          Grok Runner integrates with the following external services, each with
          their own privacy policies:
        </p>
        <ul className="list-none space-y-1 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">xAI</strong> - AI generation
            engine (your prompts are sent to xAI for processing)
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Stripe</strong> - payment
            processing (handles all credit card data)
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Resend</strong> - email
            delivery for verification codes
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Neon (PostgreSQL)</strong> -
            server-side database for accounts and transactions
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Vercel</strong> - hosting and
            serverless functions
          </li>
        </ul>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          5. DATA_RETENTION
        </h3>
        <p>
          Server-side account data is retained for the lifetime of your account.
          Rate-limiting records are automatically purged after their window
          expires. Client-side data persists until you clear your browser storage
          or uninstall the PWA. You may request account deletion at any time by
          contacting us.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          6. YOUR_RIGHTS
        </h3>
        <p>You have the right to:</p>
        <ul className="list-none space-y-1 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>Request a copy
            of all data we hold about you
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>Request
            deletion of your account and associated data
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>Clear all
            client-side data at any time via your browser settings
          </li>
        </ul>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          7. SECURITY_MEASURES
        </h3>
        <p>
          All communications use HTTPS/TLS encryption. Passwords are hashed with
          bcrypt. API keys are stored client-side only. Rate limiting protects
          against brute-force attacks. Stripe webhook signatures are verified for
          payment integrity.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          8. CONTACT
        </h3>
        <p>
          For privacy inquiries, data requests, or concerns, reach out to us via
          our Discord server or email. We aim to respond within 48 hours.
        </p>
      </section>

      <p className="font-mono-share text-[10px] text-muted-foreground/30 pt-2 border-t border-border/30">
        {"EOF // end_of_privacy_protocol.dat"}
      </p>
    </div>
  );
}

export default function LegalDialog({
  type,
  open,
  onOpenChange,
}: LegalDialogProps) {
  const isTos = type === "tos";
  const Icon = isTos ? Shield : Eye;
  const accentClass = isTos ? "text-primary" : "text-secondary";
  const borderClass = isTos ? "border-primary/30" : "border-secondary/30";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`bg-card ${borderClass} sm:max-w-2xl max-h-[85vh] flex flex-col`}
      >
        <DialogHeader>
          <DialogTitle
            className={`font-orbitron tracking-wider flex items-center gap-2 ${accentClass}`}
          >
            <Icon className="w-5 h-5" />
            {isTos ? "TERMS_OF_SERVICE" : "PRIVACY_PROTOCOL"}
          </DialogTitle>
          <DialogDescription className="font-mono-share text-[10px] text-muted-foreground/50">
            {isTos
              ? "// neural_contract v2.0 -- read before you jack in"
              : "// data_handling_manifest -- your privacy matters to us"}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 max-h-[65vh] pr-4">
          {isTos ? <TosContent /> : <PrivacyContent />}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
