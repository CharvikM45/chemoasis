-- Chemoasis forum: DRAFT Supabase tables (not run anywhere yet).
-- For Sahas to review, since he owns the Supabase project and sign-in.
-- These match what forum/js/store.js saves in the browser today, so switching
-- the forum over means replacing the store's function bodies, not the pages.
--
-- Accounts come from Supabase Auth (auth.users). If Sahas already has a
-- profiles table, forum_profiles can merge into it.

-- Who someone is in the forum. Roles and verification are set only by the team
-- (service role), never by the user, so nobody can give themselves a badge.
create table public.forum_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  bio text not null default '' check (char_length(bio) <= 300),
  show_bio boolean not null default false,
  anonymous_by_default boolean not null default false,
  large_text boolean not null default false,
  role text not null default 'member' check (role in ('member', 'creator', 'professional', 'moderator')),
  pro_verified boolean not null default false,
  pro_credential text,
  pro_specialty text,
  pro_location text,
  created_at timestamptz not null default now()
);

create table public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  category_id text not null check (category_id in ('welcome', 'experiences', 'games', 'ask-a-professional', 'app-help', 'ideas')),
  author_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 4 and 120),
  body text not null check (char_length(body) between 2 and 5000),
  label text not null default 'experience' check (label in ('experience', 'info', 'professional')),
  source_url text check (source_url is null or source_url ~ '^https?://'),
  game_ids text[] not null default '{}' check (cardinality(game_ids) <= 3),
  anonymous boolean not null default false,
  status text not null default 'visible' check (status in ('visible', 'pending', 'hidden', 'removed', 'removed-by-author')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create table public.forum_replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.forum_threads (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 2 and 5000),
  label text not null default 'experience' check (label in ('experience', 'info', 'professional')),
  source_url text check (source_url is null or source_url ~ '^https?://'),
  anonymous boolean not null default false,
  status text not null default 'visible' check (status in ('visible', 'pending', 'hidden', 'removed', 'removed-by-author')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

-- "Found this helpful". One row per person per post.
create table public.forum_helpful (
  post_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.forum_reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('thread', 'reply')),
  target_id uuid not null,
  reporter_id uuid references auth.users (id) on delete set null, -- null = the automatic safety check
  -- 'appeal' = the author asking for another review of their own hidden or removed post.
  reason text not null check (reason in ('unsafe-medical', 'misinformation', 'harassment', 'privacy', 'spam', 'other', 'appeal')),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  resolution text check (resolution in ('keep', 'hide', 'remove')),
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  moderator_note text,
  created_at timestamptz not null default now()
);

-- Muting: hides someone's named posts from you only. The muted person isn't told.
create table public.forum_mutes (
  user_id uuid not null references auth.users (id) on delete cascade,
  muted_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted_user_id),
  check (user_id <> muted_user_id)
);

create index on public.forum_threads (category_id, created_at desc);
create index on public.forum_replies (thread_id, created_at);
create index on public.forum_reports (status, target_id);

-- ---------- access rules ----------
-- How reading works: people never select from the base tables. They read the
-- *_feed views below, which apply the visibility rules and blank out the author
-- of anonymous posts. Views run with their owner's rights, which is what lets
-- them hide a column per row (row level security alone can't do that).
-- Writes (insert/update) still go to the base tables, checked by the policies.
-- People can select only the id and status columns of their own rows (an
-- UPDATE or DELETE with a WHERE clause needs that), so the app must not use
-- `insert ... returning *`; read the new row back through the feed view.

alter table public.forum_profiles enable row level security;
alter table public.forum_threads enable row level security;
alter table public.forum_replies enable row level security;
alter table public.forum_helpful enable row level security;
alter table public.forum_reports enable row level security;
alter table public.forum_mutes enable row level security;

revoke all on public.forum_profiles, public.forum_threads, public.forum_replies,
  public.forum_helpful, public.forum_reports, public.forum_mutes from anon, authenticated;

create or replace function public.forum_is_moderator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.forum_profiles where user_id = auth.uid() and role = 'moderator');
$$;

create or replace function public.forum_user_is_moderator(person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.forum_profiles where user_id = person and role = 'moderator');
$$;

-- True when the signed-in person wrote this post and a moderator has hidden or removed it.
create or replace function public.forum_can_appeal(kind text, post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case kind
    when 'thread' then exists (select 1 from public.forum_threads where id = post and author_id = auth.uid() and status in ('hidden', 'removed'))
    when 'reply' then exists (select 1 from public.forum_replies where id = post and author_id = auth.uid() and status in ('hidden', 'removed'))
    else false end
    and not exists (select 1 from public.forum_reports where target_id = post and reason = 'appeal');
$$;

create or replace function public.forum_thread_is_visible(thread uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.forum_threads where id = thread and status = 'visible');
$$;

-- Profiles. People edit only their own safe columns; role, verification and
-- credentials are set by the team with the service role, never by the user.
grant insert (user_id, display_name, bio, show_bio, anonymous_by_default, large_text) on public.forum_profiles to authenticated;
grant update (display_name, bio, show_bio, anonymous_by_default, large_text) on public.forum_profiles to authenticated;
create policy "create own profile" on public.forum_profiles for insert to authenticated
  with check (user_id = auth.uid());
create policy "edit own profile" on public.forum_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select (user_id) on public.forum_profiles to authenticated;
create policy "find own profile row" on public.forum_profiles for select to authenticated
  using (user_id = auth.uid());

create view public.forum_profiles_feed as
  select user_id, display_name,
         case when show_bio or user_id = auth.uid() then bio else '' end as bio,
         case when user_id = auth.uid() then show_bio end as show_bio,
         case when user_id = auth.uid() then anonymous_by_default end as anonymous_by_default,
         case when user_id = auth.uid() then large_text end as large_text,
         role, pro_verified,
         case when pro_verified then pro_credential end as pro_credential,
         case when pro_verified then pro_specialty end as pro_specialty,
         case when pro_verified then pro_location end as pro_location,
         created_at
  from public.forum_profiles
  where auth.uid() is not null;

-- Threads.
grant insert (category_id, author_id, title, body, label, source_url, game_ids, anonymous, status) on public.forum_threads to authenticated;
grant update (title, body, label, source_url, game_ids, status, edited_at) on public.forum_threads to authenticated;
create policy "write own threads" on public.forum_threads for insert to authenticated
  with check (author_id = auth.uid() and status in ('visible', 'pending'));
-- Authors can edit or delete their own post only while it's visible or waiting
-- for review, so they can't pull a post out from under a moderator's decision.
create policy "author edits or deletes own thread" on public.forum_threads for update to authenticated
  using (author_id = auth.uid() and status in ('visible', 'pending'))
  with check (author_id = auth.uid() and status in ('visible', 'pending', 'removed-by-author'));
create policy "moderators update threads" on public.forum_threads for update to authenticated
  using (public.forum_is_moderator()) with check (public.forum_is_moderator());
grant select (id, status) on public.forum_threads to authenticated;
create policy "find own or moderated threads" on public.forum_threads for select to authenticated
  using (author_id = auth.uid() or public.forum_is_moderator());

create view public.forum_threads_feed as
  select id, category_id,
         case when anonymous and author_id <> auth.uid() and not public.forum_is_moderator() then null else author_id end as author_id,
         title, body, label, source_url, game_ids, anonymous, status, created_at, edited_at
  from public.forum_threads
  where status = 'visible'
     or (author_id = auth.uid() and status in ('pending', 'hidden'))
     or public.forum_is_moderator();

-- Replies: only on threads everyone can see.
grant insert (thread_id, author_id, body, label, source_url, anonymous, status) on public.forum_replies to authenticated;
grant update (body, label, source_url, status, edited_at) on public.forum_replies to authenticated;
create policy "write own replies" on public.forum_replies for insert to authenticated
  with check (author_id = auth.uid() and status in ('visible', 'pending') and public.forum_thread_is_visible(thread_id));
create policy "author edits or deletes own reply" on public.forum_replies for update to authenticated
  using (author_id = auth.uid() and status in ('visible', 'pending'))
  with check (author_id = auth.uid() and status in ('visible', 'pending', 'removed-by-author'));
create policy "moderators update replies" on public.forum_replies for update to authenticated
  using (public.forum_is_moderator()) with check (public.forum_is_moderator());
grant select (id, status) on public.forum_replies to authenticated;
create policy "find own or moderated replies" on public.forum_replies for select to authenticated
  using (author_id = auth.uid() or public.forum_is_moderator());

create view public.forum_replies_feed as
  select id, thread_id,
         case when anonymous and author_id <> auth.uid() and not public.forum_is_moderator() then null else author_id end as author_id,
         body, label, source_url, anonymous, status, created_at, edited_at
  from public.forum_replies
  where status = 'visible'
     or (author_id = auth.uid() and status in ('pending', 'hidden'))
     or public.forum_is_moderator();

-- "Found this helpful": people see counts and their own marks, never who else marked a post.
grant insert, delete on public.forum_helpful to authenticated;
grant select (post_id, user_id) on public.forum_helpful to authenticated;
create policy "see own marks" on public.forum_helpful for select to authenticated using (user_id = auth.uid());
create policy "mark helpful" on public.forum_helpful for insert to authenticated with check (user_id = auth.uid());
create policy "unmark helpful" on public.forum_helpful for delete to authenticated using (user_id = auth.uid());

create view public.forum_helpful_counts as
  select post_id, count(*)::int as helpful_count, bool_or(user_id = auth.uid()) as marked_by_me
  from public.forum_helpful
  group by post_id;

-- Reports are private: people can file them; only moderators read and resolve them.
grant insert (target_type, target_id, reporter_id, reason, note) on public.forum_reports to authenticated;
grant select, update on public.forum_reports to authenticated;
-- Appeals are only for your own hidden or removed post, once per post.
create policy "file a report" on public.forum_reports for insert to authenticated
  with check (reporter_id = auth.uid() and (reason <> 'appeal' or public.forum_can_appeal(target_type, target_id)));
create policy "read reports" on public.forum_reports for select to authenticated
  using (reporter_id = auth.uid() or public.forum_is_moderator());
create policy "moderators resolve reports" on public.forum_reports for update to authenticated
  using (public.forum_is_moderator()) with check (public.forum_is_moderator());

-- Mutes are private to the person who set them. Moderators can't be muted, so safety notices always get through.
grant select, insert, delete on public.forum_mutes to authenticated;
create policy "see own mutes" on public.forum_mutes for select to authenticated using (user_id = auth.uid());
create policy "mute someone" on public.forum_mutes for insert to authenticated
  with check (user_id = auth.uid() and not public.forum_user_is_moderator(muted_user_id));
create policy "unmute someone" on public.forum_mutes for delete to authenticated using (user_id = auth.uid());

grant select on public.forum_profiles_feed, public.forum_threads_feed, public.forum_replies_feed,
  public.forum_helpful_counts to authenticated;

-- Still to decide with the team before this goes live:
-- 1. The safety check, the "Professional guidance" rule (verified professionals
--    only, never anonymous) and auto-hide after 3 reports should also run in a
--    trigger or Edge Function, so a modified app can't skip them.
-- 2. Edits by authors should go through the same safety check as new posts,
--    and set edited_at in the same trigger so it can't be skipped.
-- 3. Muting is applied by the app when it reads the feed (anonymous posts are
--    never muted, because hiding one would reveal who wrote it).
