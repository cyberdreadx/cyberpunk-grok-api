-- Let the notifications table accept the notifications the app actually sends.
--
-- The CHECK constraint allowed: like, comment, reply, follow, subscribe, rating,
-- new_post. The app sends: comment, follow, unlock, dm, system, upvote, credits.
-- The only two values in both lists are comment and follow — which is precisely
-- what the table contained: 39 follows and 31 comments, and nothing else, ever.
--
-- Every upvote, unlock, DM and system notification was rejected by the database,
-- and notify() catches and logs its errors so the caller never fails. 2,555
-- upvotes were awarded karma in the last 90 days; not one of those people was
-- told. This is the second silent-constraint bug on this table — the first was
-- `message NOT NULL` with no default.
--
-- The vocabulary is the union of both lists: the app's real types, plus the
-- legacy values so any older writer and every existing row still validates.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    -- what the code sends today (api/_lib/notify.ts callers)
    'comment', 'follow', 'unlock', 'dm', 'system', 'upvote', 'credits',
    -- legacy vocabulary, kept so existing rows and any older writer still pass
    'like', 'reply', 'subscribe', 'rating', 'new_post'
  ]::text[])
);
