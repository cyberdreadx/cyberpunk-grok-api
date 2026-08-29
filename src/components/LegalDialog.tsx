import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Shield, Eye } from "lucide-react";
import { APP_VERSION } from "@/lib/version";

type LegalType = "tos" | "privacy";

interface LegalDialogProps {
  type: LegalType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Exported so /terms can render the same text the dialog shows — one source
 *  of truth, so a public legal page can never drift from the in-app one. */
export function TosContent() {
  return (
    <div className="space-y-5 font-rajdhani text-sm text-foreground/80 leading-relaxed">
      <p className="font-mono-share text-xs text-primary/60 border border-primary/20 rounded p-3 bg-primary/5">
        <span className="text-primary">$</span> cat /sys/legal/terms_of_service.dat
        <br />
        <span className="text-muted-foreground/40">
          {`// Last updated: 2026.03.16 // Protocol v${APP_VERSION}`}
        </span>
      </p>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          1. NEURAL_CONTRACT_ACCEPTANCE
        </h3>
        <p>
          By accessing or using GLTCH Runner ("the Platform", "the Service"), operated
          by CyberDread ("we", "us", "our"), you agree to be legally bound by these
          Terms of Service. If you do not accept these terms, you must immediately
          stop using the Platform. Continued use constitutes full acceptance of all
          provisions outlined below, including the limitation of liability,
          indemnification, and dispute resolution clauses.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          2. PLATFORM_AS_INTERMEDIARY
        </h3>
        <p>
          GLTCH Runner is an <strong>intermediary platform</strong> that provides a user
          interface for third-party AI generation services, specifically the xAI API.
          We do not create, control, or pre-screen AI-generated outputs. All content
          generation is performed by xAI's infrastructure and models. We function solely
          as a technical relay between users and the xAI API. We do not train, fine-tune,
          or modify the underlying AI models. The Platform qualifies as an "interactive
          computer service" under Section 230 of the Communications Decency Act (47 U.S.C.
          § 230), and we are not the "information content provider" of any user-generated
          or AI-generated content accessed through our Service.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          3. OPERATOR_ELIGIBILITY
        </h3>
        <p>
          You must be at least <strong>18 years of age</strong> (or the age of legal
          majority in your jurisdiction, whichever is greater) to use this Platform.
          By using GLTCH Runner, you represent and warrant that you meet this requirement.
          We reserve the right to immediately terminate any account suspected of being
          operated by a minor, without notice or refund.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          4. ACCEPTABLE_USE_POLICY
        </h3>
        <p>
          You are <strong>solely and fully responsible</strong> for all prompts you
          submit and all content generated through your use of the Platform. You agree
          NOT to use GLTCH Runner to generate, attempt to generate, solicit, store, or
          distribute any of the following:
        </p>
        <ul className="list-none space-y-1.5 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-destructive mr-2">!!</span>
            <strong>Child Sexual Abuse Material (CSAM)</strong> or any sexual, suggestive,
            or exploitative depiction of minors in any form whatsoever
          </li>
          <li>
            <span className="text-destructive mr-2">!!</span>
            <strong>Non-consensual intimate imagery</strong> (NCII), including AI-generated
            deepfakes of real individuals in sexual or compromising scenarios
          </li>
          <li>
            <span className="text-destructive mr-2">!!</span>
            <strong>Realistic depictions of identified real persons</strong> without
            their consent, particularly in defamatory, sexual, violent, or fraudulent contexts
          </li>
          <li>
            <span className="text-destructive mr-2">!!</span>
            Content promoting <strong>terrorism, extremist violence, or radicalization</strong>
          </li>
          <li>
            <span className="text-destructive mr-2">!!</span>
            Content facilitating <strong>fraud, impersonation, scams, or identity theft</strong>
          </li>
          <li>
            <span className="text-destructive mr-2">!!</span>
            Content that constitutes or facilitates <strong>harassment, threats, stalking,
            or doxxing</strong> of any individual
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>
            Any other content that violates applicable local, state, federal, or
            international law
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>
            Attempts to bypass, circumvent, or defeat xAI safety filters or content policies
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>
            Reverse-engineering, scraping, overloading, or interfering with Platform infrastructure
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>
            Automated bots, scripts, or bulk generation not authorized by us
          </li>
        </ul>
        <p className="mt-3 text-foreground/90 font-semibold">
          ZERO TOLERANCE: We maintain a strict zero-tolerance policy for CSAM and
          non-consensual intimate imagery. Any suspected CSAM will be reported to the
          National Center for Missing & Exploited Children (NCMEC) and relevant law
          enforcement agencies, as required by federal law (18 U.S.C. § 2258A). We
          will cooperate fully with any law enforcement investigation.
        </p>
        <p className="mt-2">
          Violations will result in <strong>immediate, permanent account termination</strong>,
          forfeiture of all credits, and reporting to appropriate authorities where
          required by law. No refunds will be issued.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          5. USER_CONTENT_RESPONSIBILITY
        </h3>
        <p>
          <strong>You bear sole legal responsibility</strong> for all content generated
          through your account. The Platform does not review, approve, endorse, or take
          responsibility for any AI-generated output. You acknowledge that:
        </p>
        <ul className="list-none space-y-1.5 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-primary/40 mr-2">//</span>
            AI-generated content may inadvertently resemble copyrighted works, trademarks,
            or real individuals — you are responsible for verifying legality before use
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>
            AI outputs are not guaranteed to be accurate, legal, or fit for any purpose
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>
            You must comply with all applicable laws in your jurisdiction regarding
            AI-generated content, including copyright, right of publicity, and defamation laws
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>
            Using generated content for commercial purposes is at your own risk and
            subject to xAI's terms
          </li>
        </ul>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          6. CONTENT_MODERATION
        </h3>
        <p>
          The Platform relies primarily on xAI's built-in content filtering and safety
          systems. Additionally, we reserve the right (but have no obligation) to:
        </p>
        <ul className="list-none space-y-1 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-primary/40 mr-2">//</span>
            Log generation metadata (type, cost, timestamps) for billing and abuse detection
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>
            Monitor usage patterns for signs of abuse or policy violations
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>
            Suspend or terminate accounts engaged in suspicious activity
          </li>
          <li>
            <span className="text-primary/40 mr-2">//</span>
            Report illegal activity to law enforcement without prior notice to the user
          </li>
        </ul>
        <p className="mt-2">
          Content moderation does not create any duty to monitor, and failure to detect
          a violation does not constitute endorsement or approval of any content.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          7. CREDITS_AND_PAYMENTS
        </h3>
        <p>
          Credits are a virtual currency used to pay for generations through our
          relay. Credits are non-refundable, non-transferable, and have no
          real-world cash value. Subscription credits reset each billing cycle
          and do not roll over. Credit packs do not expire. We reserve the right
          to adjust credit costs as API pricing changes. All payments are processed
          by Stripe; we do not store payment card information.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          8. SUBSCRIPTION_CANCELLATION
        </h3>
        <p>
          You may cancel your subscription at any time through the billing portal.
          Cancellation takes effect at the end of your current billing period.
          Until then, you retain access to your subscription credits. No pro rata
          refunds are offered for partial months. Once cancelled, you will not be
          charged again, and your subscription credits will stop replenishing.
          Pack credits (one-time purchases) are unaffected and never expire.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          9. CONTENT_OWNERSHIP_AND_IP
        </h3>
        <p>
          Generated content is subject to xAI's terms of service and applicable
          intellectual property law. We do not claim ownership of your prompts or
          generated outputs. Generated content is stored locally in your browser
          (IndexedDB) — we do not store your images or videos on our servers. You
          acknowledge that AI-generated content may not be eligible for copyright
          protection under current law. You represent that you will not use generated
          content in a way that infringes on the intellectual property rights of
          any third party.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          10. DMCA_TAKEDOWN_PROCEDURE
        </h3>
        <p>
          If you believe that content accessible through the Platform infringes your
          copyright, you may submit a DMCA takedown notice to our designated agent.
          Notices must include: (1) identification of the copyrighted work, (2)
          identification of the infringing material, (3) your contact information,
          (4) a statement of good faith belief, (5) a statement of accuracy under
          penalty of perjury, and (6) your physical or electronic signature. Send
          notices to: <span className="text-primary font-mono-share">dmca@grokrunner.gltch.app</span>.
          We will respond to valid DMCA notices in accordance with the Digital
          Millennium Copyright Act (17 U.S.C. § 512).
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          11. BYOK_MODE_DISCLAIMER
        </h3>
        <p>
          When using Bring Your Own Key (BYOK) mode, your xAI API key is stored
          exclusively in your browser localStorage. We never transmit, log, or
          store your API key on our servers. You are solely responsible for any
          charges incurred on your xAI account. In BYOK mode, your prompts are sent
          directly from your browser to xAI without passing through our servers.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          12. NO_WARRANTIES
        </h3>
        <p>
          THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF
          ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING BUT NOT LIMITED
          TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
          NON-INFRINGEMENT, AND TITLE. We do not warrant that the Service will be
          uninterrupted, error-free, secure, or that any content generated will be
          legal, accurate, non-infringing, or suitable for any purpose. xAI may change
          their APIs at any time, which could affect functionality without notice.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          13. LIMITATION_OF_LIABILITY
        </h3>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL
          CYBERDREAD, ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, OR AFFILIATES
          BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
          DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, USE, GOODWILL,
          OR OTHER INTANGIBLE LOSSES, RESULTING FROM: (A) YOUR USE OF OR INABILITY
          TO USE THE SERVICE; (B) ANY CONTENT GENERATED THROUGH THE SERVICE; (C) ANY
          UNAUTHORIZED ACCESS TO YOUR ACCOUNT; (D) ANY THIRD-PARTY CLAIMS ARISING
          FROM CONTENT YOU GENERATED OR DISTRIBUTED; OR (E) ANY OTHER MATTER RELATING
          TO THE SERVICE. OUR TOTAL AGGREGATE LIABILITY SHALL NOT EXCEED THE AMOUNT
          YOU PAID TO US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR FIFTY
          U.S. DOLLARS ($50), WHICHEVER IS GREATER.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          14. INDEMNIFICATION
        </h3>
        <p>
          You agree to <strong>indemnify, defend, and hold harmless</strong> CyberDread
          and its officers, directors, employees, agents, and affiliates from and against
          any and all claims, damages, obligations, losses, liabilities, costs, and
          expenses (including reasonable attorneys' fees) arising from: (a) your use of
          the Platform; (b) content you generate, store, or distribute using the
          Platform; (c) your violation of these Terms; (d) your violation of any
          applicable law or third-party rights; or (e) any dispute between you and a
          third party related to content generated through your account.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          15. ACCOUNT_TERMINATION
        </h3>
        <p>
          We may suspend or terminate your account at any time, with or without cause,
          with or without notice, at our sole discretion. Grounds for termination include
          but are not limited to: violations of these Terms, suspected illegal activity,
          suspected fraud, abuse of the credit system, or any behavior we determine to
          be harmful to the Platform or its users. Upon termination, any remaining credits
          are forfeited. You may delete your own account at any time through the
          Platform interface.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          16. GOVERNING_LAW_AND_JURISDICTION
        </h3>
        <p>
          These Terms shall be governed by and construed in accordance with the laws of
          the United States and the State of Delaware, without regard to conflict of law
          principles. You consent to the exclusive jurisdiction and venue of the state
          and federal courts located in Delaware for all disputes arising out of or
          relating to these Terms or the Service.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          17. DISPUTE_RESOLUTION
        </h3>
        <p>
          Any dispute, controversy, or claim arising out of or relating to these Terms
          or the Service shall first be attempted to be resolved through good-faith
          negotiation. If the dispute cannot be resolved within thirty (30) days, either
          party may initiate binding arbitration administered by a mutually agreed-upon
          arbitration provider, conducted in English. YOU AGREE THAT ANY CLAIMS SHALL BE
          BROUGHT IN YOUR INDIVIDUAL CAPACITY AND NOT AS A PLAINTIFF OR CLASS MEMBER IN
          ANY PURPORTED CLASS OR REPRESENTATIVE PROCEEDING (class action waiver).
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-primary mb-2">
          18. SEVERABILITY_AND_MODIFICATIONS
        </h3>
        <p>
          If any provision of these Terms is found to be unenforceable or invalid, that
          provision shall be limited or eliminated to the minimum extent necessary, and
          the remaining provisions shall remain in full force and effect. We reserve the
          right to update these Terms at any time. Material changes will be communicated
          via the Platform. Continued use after changes constitutes acceptance of the
          updated Terms.
        </p>
      </section>

      <p className="font-mono-share text-[10px] text-muted-foreground/30 pt-2 border-t border-border/30">
        {"EOF // end_of_neural_contract_v3.dat"}
      </p>
    </div>
  );
}

export function PrivacyContent() {
  const arrow = ">>";
  return (
    <div className="space-y-5 font-rajdhani text-sm text-foreground/80 leading-relaxed">
      <p className="font-mono-share text-xs text-secondary/60 border border-secondary/20 rounded p-3 bg-secondary/5">
        <span className="text-secondary">$</span> cat /sys/legal/privacy_protocol.dat
        <br />
        <span className="text-muted-foreground/40">
          {`// Last updated: 2026.04.20 // Protocol v${APP_VERSION} // Encryption: AES-256`}
        </span>
      </p>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          1. DATA_COLLECTION
        </h3>
        <p>
          We believe in minimal data harvesting. Here is exactly what we collect on our servers:
        </p>
        <ul className="list-none space-y-1 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Email address</strong> — for
            account creation, verification, and password resets
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Password hash</strong> —
            bcrypt-hashed; we never see your raw password
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Profile data</strong> —
            optional username, bio, avatar URL, and (if you opt in) a public
            Base wallet address used for $XRGE creator payouts
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Device fingerprint &amp; trusted-device records</strong>{" "}
            — used for abuse prevention and 2FA "remember this device" only
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Usage logs</strong> —
            generation type, credit costs, and timestamps for billing and abuse
            detection. Prompt text is logged only when required to verify
            daily-mission actions or moderate flagged feed posts
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Email delivery log</strong> —
            transactional email status (sent / bounced / delayed) is stored so we
            can surface delivery problems to you
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Payment data</strong> —
            processed entirely by Stripe; we only store transaction IDs.
            On-chain $XRGE order references are stored when you pay with crypto
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
            {" "}— stored in IndexedDB as binary blobs
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Folder structure and PIN hashes</strong>
            {" "}— stored in IndexedDB and localStorage
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Prompt history, engine choice, language &amp; theme</strong>
            {" "}— stored in localStorage
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">xAI / RunPod API keys (BYOK mode)</strong>
            {" "}— stored in localStorage, never transmitted to us
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Share-link map</strong>
            {" "}— links your local results to /s/:id IDs so deleting a result can
            also tear down the public share
          </li>
        </ul>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          3. SERVER_SIDE_MEDIA_STORAGE
        </h3>
        <p>
          You only upload media to our servers when you <strong>choose to</strong> —
          generations stay on your device by default. The following actions
          publish files to Vercel Blob storage:
        </p>
        <ul className="list-none space-y-1 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Posting to the community feed</strong>
            {" "}— image is hosted publicly until you delete the post
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Stories</strong>
            {" "}— media is hosted for up to 24 hours, then auto-deleted by a cron
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Avatars</strong>
            {" "}— previous avatar is purged when you upload a new one
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Share links (/s/:id)</strong>
            {" "}— you create a public copy of a single result so it can be opened
            without an account; ownership is tracked so only you can take it down
          </li>
        </ul>
        <p className="mt-3 text-foreground/90">
          When you delete any of the above, the underlying file is removed from
          Vercel Blob storage automatically. A weekly cron also sweeps for
          orphaned files (anything no longer referenced by a post, story, profile,
          or share) and deletes them after a 24-hour safety window.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          4. DATA_WE_DO_NOT_COLLECT
        </h3>
        <p>To be crystal clear, we do NOT collect or store:</p>
        <ul className="list-none space-y-1 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-primary/40 mr-2">!!</span>Your generations, by
            default — they live on your device unless you publish or share them
          </li>
          <li>
            <span className="text-primary/40 mr-2">!!</span>Your IP address
            beyond short rate-limiting and abuse-prevention windows
          </li>
          <li>
            <span className="text-primary/40 mr-2">!!</span>Tracking cookies,
            third-party analytics, or advertising identifiers
          </li>
          <li>
            <span className="text-primary/40 mr-2">!!</span>BYOK API keys — they
            never leave your browser
          </li>
          <li>
            <span className="text-primary/40 mr-2">!!</span>Any data sold to
            third parties — ever
          </li>
        </ul>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          5. THIRD_PARTY_SERVICES
        </h3>
        <p>
          The Platform integrates with the following external services, each
          governed by its own privacy policy:
        </p>
        <ul className="list-none space-y-1 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">xAI</strong> — image,
            video, and chat generation (your prompts are sent to xAI for processing)
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">RunPod / ComfyUI workers</strong>
            {" "}— GLTCH and GLTCH PRO generation pipelines
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">DeepSeek</strong> — optional
            backend for character chat
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Stripe</strong> — payment
            processing for subscriptions and credit packs
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Base network ($XRGE)</strong>
            {" "}— optional on-chain payments and creator payouts
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Resend</strong> — verification
            and transactional email delivery
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Telegram</strong> — only if
            you link your Telegram account to the bot
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Neon (PostgreSQL)</strong> —
            server-side database for accounts, credits, and transactions
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>
            <strong className="text-foreground/90">Vercel</strong> — hosting,
            serverless functions, and Blob storage for media you publish
          </li>
        </ul>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          6. DATA_RETENTION
        </h3>
        <p>
          Server-side account data is retained for the lifetime of your account.
          Stories self-destruct after 24 hours. Posts, avatars, and shares are
          retained until you delete them — at which point the underlying media
          file is purged from Blob storage as well. Rate-limiting records are
          automatically purged after their window expires. Client-side data
          persists until you clear your browser storage or uninstall the PWA.
          You may delete your account at any time from Settings; this also
          removes your profile data, posts, stories, and any associated media.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          7. YOUR_RIGHTS
        </h3>
        <p>You have the right to:</p>
        <ul className="list-none space-y-1 pl-4 mt-2 text-foreground/70">
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>Request a copy
            of all data we hold about you
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>Delete your
            account and associated data directly from Settings
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>Take down any
            share link you created — deleting the source result also tears down
            the public /s/:id page and its underlying file
          </li>
          <li>
            <span className="text-secondary/40 mr-2">{arrow}</span>Clear all
            client-side data at any time via your browser settings
          </li>
        </ul>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          8. SECURITY_MEASURES
        </h3>
        <p>
          All communications use HTTPS/TLS encryption with HSTS enforced.
          Passwords are bcrypt-hashed. Optional two-factor authentication (2FA)
          via email is available in Settings, with trusted-device support.
          Rate limiting, disposable-email blocking, IP throttling, and device
          fingerprinting protect against abuse. Stripe webhook signatures and
          on-chain $XRGE transactions are verified server-side. Public API keys
          are SHA-256 hashed at rest.
        </p>
      </section>

      <section>
        <h3 className="font-orbitron text-xs tracking-wider text-secondary mb-2">
          9. CONTACT
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
        className={`bg-card ${borderClass} sm:max-w-2xl max-h-[85vh] !flex flex-col`}
      >
        <DialogHeader className="flex-shrink-0">
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
        <div className="flex-1 min-h-0 overflow-y-auto pr-2 -mr-2 overscroll-contain">
          {isTos ? <TosContent /> : <PrivacyContent />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
