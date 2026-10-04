/**
 * How long expiring credits last. See migrations/073_credit_lots.sql.
 *
 * Promo: giveaways — mission and streak rewards, free spins, referral bonuses,
 * promo codes, the starter grant, community pot. These are the credits people
 * farm, and expiring them carries no consumer-protection risk because nobody
 * paid for them. Matches the 90 days Higgsfield uses.
 *
 * Paid: packs bought AFTER this shipped, with the date disclosed at checkout.
 * Deliberately 12 months, not Higgsfield's 90: short expiry on money someone
 * handed over invites chargebacks and complaints, and several US states and the
 * EU treat aggressive expiry on prepaid value harshly. Credits bought before
 * this change have no lot and never expire.
 *
 * Never expire, by design: subscription grants, creator earnings, refunds, and
 * credits an admin grants by hand — a goodwill grant that quietly vanished in
 * 90 days would undo the apology it was given for.
 */
/*
 * Both are OFF until the owner approves the customer-facing wording.
 *
 * The Terms of Service (section 7 and 8) promise in writing that "Credit packs
 * do not expire" and that pack credits "never expire". Selling under that
 * promise and then expiring the credit is exactly the exposure this design was
 * meant to avoid, so nothing may expire until the Terms, the pricing page and
 * the How To Use copy say so. A value of 0 means "grant normally, no lot" — the
 * credits behave exactly as they always have. Flip with CREDIT_EXPIRY_PROMO=1
 * and CREDIT_EXPIRY_PAID=1 once the copy is live; neither is retroactive.
 */
export const PROMO_CREDIT_DAYS = process.env.CREDIT_EXPIRY_PROMO === "1" ? 90 : 0;
export const PAID_CREDIT_DAYS = process.env.CREDIT_EXPIRY_PAID === "1" ? 365 : 0;
