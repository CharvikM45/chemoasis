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
  created_at timestamptz not null default now()
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
  created_at timestamptz not null default now()
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
  reason text not null check (reason in ('unsafe-medical', 'misinformation', 'harassment', 'privacy', 'spam', 'other')),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  resolution text check (resolution in ('keep', 'hide', 'remove')),
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  moderator_note text,
  created_at timestamptz not null default now()
);

create index on public.forum_threads (category_id, created_at desc);
create index on public.forum_replies (thread_id, created_at);
create index on public.forum_reports (status, target_id);

-- ---------- row level security ----------

alter table public.forum_profiles enable row level security;
alter table public.forum_threads enable row level security;
alter table public.forum_replies enable row level security;
alter table public.forum_helpful enable row level security;
alter table public.forum_reports enable row level security;

create or replace function public.forum_is_moderator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.forum_profiles where user_id = auth.uid() and role = 'moderator');
$$;

-- Profiles: signed-in people can read profiles; you can edit only your own safe fields.
-- (Hide bio when show_bio is false through a view or the app; RLS works per row, not per column.)
create policy "profiles readable" on public.forum_profiles for select to authenticated using (true);
create policy "create own profile" on public.forum_profiles for insert to authenticated
  with check (user_id = auth.uid() and role = 'member' and pro_verified = false);
create policy "edit own profile" on public.forum_profiles for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and role = (select role from public.forum_profiles where user_id = auth.uid())
    and pro_verified = (select pro_verified from public.forum_profiles where user_id = auth.uid())
  );

-- Threads and replies: everyone signed in sees visible posts; authors see their own;
-- moderators see everything except posts the author deleted.
create policy "read threads" on public.forum_threads for select to authenticated
  using (status = 'visible' or author_id = auth.uid() or (public.forum_is_moderator() and status <> 'removed-by-author'));
create policy "write own threads" on public.forum_threads for insert to authenticated
  with check (author_id = auth.uid() and status in ('visible', 'pending'));
create policy "author deletes own thread" on public.forum_threads for update to authenticated
  using (author_id = auth.uid()) with check (status = 'removed-by-author');
create policy "moderators update threads" on public.forum_threads for update to authenticated
  using (public.forum_is_moderator());

create policy "read replies" on public.forum_replies for select to authenticated
  using (status = 'visible' or author_id = auth.uid() or (public.forum_is_moderator() and status <> 'removed-by-author'));
create policy "write own replies" on public.forum_replies for insert to authenticated
  with check (author_id = auth.uid() and status in ('visible', 'pending'));
create policy "author deletes own reply" on public.forum_replies for update to authenticated
  using (author_id = auth.uid()) with check (status = 'removed-by-author');
create policy "moderators update replies" on public.forum_replies for update to authenticated
  using (public.forum_is_moderator());

create policy "read helpful" on public.forum_helpful for select to authenticated using (true);
create policy "mark helpful" on public.forum_helpful for insert to authenticated with check (user_id = auth.uid());
create policy "unmark helpful" on public.forum_helpful for delete to authenticated using (user_id = auth.uid());

-- Reports are private: reporters see their own, moderators see all.
create policy "file a report" on public.forum_reports for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'open');
create policy "read reports" on public.forum_reports for select to authenticated
  using (reporter_id = auth.uid() or public.forum_is_moderator());
create policy "moderators resolve reports" on public.forum_reports for update to authenticated
  using (public.forum_is_moderator());

-- Still to decide with the team before this goes live:
-- 1. "Professional guidance" labels should be enforced on the server too
--    (a trigger that checks role = 'professional' and pro_verified).
-- 2. Auto-hide after 3 reports and the automatic safety hold should run in a
--    database function or Edge Function, so they can't be skipped.
-- 3. Anonymous posts: the app must not send author_id to other users for them.
--    A view that blanks author_id when anonymous is true would handle it.
