-- Chemoasis forum: DRAFT database for a Railway Postgres backend (not run anywhere yet).
-- For Sahas to review, since he owns the backend and sign-in.
--
-- The backend is Railway, not Supabase (decided 2026-10-24), so this is plain
-- PostgreSQL with no Supabase Auth. Two things replace what Supabase gave us for free:
--
--   1. Identity. There is no auth.users table. Every person is a row in
--      forum_accounts (just a uuid). Point these foreign keys at the real accounts
--      table your sign-in creates, or let sign-in insert a forum_accounts row per
--      person. The forum only needs one stable uuid per person.
--
--   2. "Who is asking?" There is no auth.uid(). Instead, your API server opens a
--      transaction per request and runs, once, before any forum query:
--          set local role forum_app;
--          set local forum.current_account = '<the signed-in person''s uuid>';
--      forum_current_user() reads that setting. A request with it unset (an admin
--      script, a migration, the psql prompt) is treated as trusted and skips the
--      per-user checks, the way Supabase's service role did.
--
-- These match what forum/assets/js/store.js saves in the browser today, so switching
-- the forum over means replacing the store's function bodies, not the pages.

create extension if not exists pgcrypto; -- for gen_random_uuid() on older servers

-- A person. Placeholder: merge with, or point at, the accounts table sign-in creates.
create table forum_accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- The role your API server runs forum queries as (set local role forum_app). It is a
-- NOLOGIN group role: your Railway connection role is granted membership and switches to
-- it per request, so forum queries never run with more rights than these grants allow.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'forum_app') then
    create role forum_app nologin;
  end if;
end $$;

-- The signed-in person for this request, or null for a trusted/admin connection.
create or replace function forum_current_user()
returns uuid language sql stable as $$
  select nullif(current_setting('forum.current_account', true), '')::uuid;
$$;

-- Who someone is in the forum. Roles and verification are set only by the team
-- (a trusted connection), never by the user, so nobody can give themselves a badge.
create table forum_profiles (
  user_id uuid primary key references forum_accounts (id) on delete cascade,
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

create table forum_threads (
  id uuid primary key default gen_random_uuid(),
  category_id text not null check (category_id in ('welcome', 'experiences', 'games', 'ask-a-professional', 'app-help', 'ideas')),
  author_id uuid not null references forum_accounts (id) on delete cascade,
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

create table forum_replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references forum_threads (id) on delete cascade,
  author_id uuid not null references forum_accounts (id) on delete cascade,
  body text not null check (char_length(body) between 2 and 5000),
  label text not null default 'experience' check (label in ('experience', 'info', 'professional')),
  source_url text check (source_url is null or source_url ~ '^https?://'),
  anonymous boolean not null default false,
  status text not null default 'visible' check (status in ('visible', 'pending', 'hidden', 'removed', 'removed-by-author')),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

-- "Found this helpful". One row per person per post.
create table forum_helpful (
  post_id uuid not null,
  user_id uuid not null references forum_accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table forum_reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('thread', 'reply')),
  target_id uuid not null,
  reporter_id uuid references forum_accounts (id) on delete set null, -- null = the automatic safety check
  -- 'appeal' = the author asking for another review of their own hidden or removed post.
  reason text not null check (reason in ('unsafe-medical', 'misinformation', 'harassment', 'privacy', 'spam', 'other', 'appeal')),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  resolution text check (resolution in ('keep', 'hide', 'remove')),
  resolved_by uuid references forum_accounts (id),
  resolved_at timestamptz,
  moderator_note text,
  created_at timestamptz not null default now()
);

-- Muting: hides someone's named posts from you only. The muted person isn't told.
create table forum_mutes (
  user_id uuid not null references forum_accounts (id) on delete cascade,
  muted_user_id uuid not null references forum_accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted_user_id),
  check (user_id <> muted_user_id)
);

create index on forum_threads (category_id, created_at desc);
create index on forum_replies (thread_id, created_at);
create index on forum_reports (status, target_id);

-- ---------- access rules ----------
-- edited_at is set by the forum_guard_post trigger below, never by the app.
-- How reading works: people never select from the base tables. They read the
-- *_feed views below, which apply the visibility rules and blank out the author
-- of anonymous posts. The views are owned by the migration role (not forum_app),
-- so they see all rows and can hide a column per row, which row level security
-- alone can't do. forum_app is granted select on the views only.
-- Writes (insert/update) go to the base tables, checked by the policies.
-- forum_app can select only the id and status columns of its own rows (an UPDATE
-- or DELETE with a WHERE clause needs that), so the app must not use
-- `insert ... returning *`; read the new row back through the feed view.

alter table forum_profiles enable row level security;
alter table forum_threads enable row level security;
alter table forum_replies enable row level security;
alter table forum_helpful enable row level security;
alter table forum_reports enable row level security;
alter table forum_mutes enable row level security;

revoke all on forum_accounts, forum_profiles, forum_threads, forum_replies,
  forum_helpful, forum_reports, forum_mutes from public;

-- Helper functions run as their owner (the migration role), so they can read
-- forum_profiles even though forum_app cannot select arbitrary rows from it.
create or replace function forum_is_moderator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from forum_profiles where user_id = forum_current_user() and role = 'moderator');
$$;

create or replace function forum_user_is_moderator(person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from forum_profiles where user_id = person and role = 'moderator');
$$;

-- True when the signed-in person wrote this post and a moderator has hidden or removed it.
create or replace function forum_can_appeal(kind text, post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case kind
    when 'thread' then exists (select 1 from forum_threads where id = post and author_id = forum_current_user() and status in ('hidden', 'removed'))
    when 'reply' then exists (select 1 from forum_replies where id = post and author_id = forum_current_user() and status in ('hidden', 'removed'))
    else false end
    and not exists (select 1 from forum_reports where target_id = post and reason = 'appeal');
$$;

create or replace function forum_thread_is_visible(thread uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from forum_threads where id = thread and status = 'visible');
$$;

create or replace function forum_post_is_visible(post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from forum_threads where id = post and status = 'visible')
      or exists (select 1 from forum_replies r where r.id = post and r.status = 'visible'
                 and forum_thread_is_visible(r.thread_id));
$$;

-- Profiles. People edit only their own safe columns; role, verification and
-- credentials are set by the team on a trusted connection, never by the user.
grant insert (user_id, display_name, bio, show_bio, anonymous_by_default, large_text) on forum_profiles to forum_app;
grant update (display_name, bio, show_bio, anonymous_by_default, large_text) on forum_profiles to forum_app;
create policy "create own profile" on forum_profiles for insert to forum_app
  with check (user_id = forum_current_user());
create policy "edit own profile" on forum_profiles for update to forum_app
  using (user_id = forum_current_user()) with check (user_id = forum_current_user());
grant select (user_id) on forum_profiles to forum_app;
create policy "find own profile row" on forum_profiles for select to forum_app
  using (user_id = forum_current_user());

create view forum_profiles_feed as
  select user_id, display_name,
         case when show_bio or user_id = forum_current_user() then bio else '' end as bio,
         case when user_id = forum_current_user() then show_bio end as show_bio,
         case when user_id = forum_current_user() then anonymous_by_default end as anonymous_by_default,
         case when user_id = forum_current_user() then large_text end as large_text,
         role, pro_verified,
         case when pro_verified then pro_credential end as pro_credential,
         case when pro_verified then pro_specialty end as pro_specialty,
         case when pro_verified then pro_location end as pro_location,
         created_at
  from forum_profiles
  where forum_current_user() is not null;

-- Threads.
grant insert (category_id, author_id, title, body, label, source_url, game_ids, anonymous, status) on forum_threads to forum_app;
grant update (title, body, label, source_url, game_ids, status) on forum_threads to forum_app;
create policy "write own threads" on forum_threads for insert to forum_app
  with check (author_id = forum_current_user() and status in ('visible', 'pending'));
-- Authors can edit or delete their own post only while it's visible or waiting
-- for review, so they can't pull a post out from under a moderator's decision.
create policy "author edits or deletes own thread" on forum_threads for update to forum_app
  using (author_id = forum_current_user() and status in ('visible', 'pending'))
  with check (author_id = forum_current_user() and status in ('visible', 'pending', 'removed-by-author'));
create policy "moderators update threads" on forum_threads for update to forum_app
  using (forum_is_moderator()) with check (forum_is_moderator());
grant select (id, status) on forum_threads to forum_app;
create policy "find own or moderated threads" on forum_threads for select to forum_app
  using (author_id = forum_current_user() or forum_is_moderator());

create view forum_threads_feed as
  select id, category_id,
         case when anonymous and author_id <> forum_current_user() and not forum_is_moderator() then null else author_id end as author_id,
         title, body, label, source_url, game_ids, anonymous, status, created_at, edited_at
  from forum_threads
  where status = 'visible'
     or (author_id = forum_current_user() and status in ('pending', 'hidden', 'removed'))
     or forum_is_moderator();

-- Replies: only on threads everyone can see.
grant insert (thread_id, author_id, body, label, source_url, anonymous, status) on forum_replies to forum_app;
grant update (body, label, source_url, status) on forum_replies to forum_app;
create policy "write own replies" on forum_replies for insert to forum_app
  with check (author_id = forum_current_user() and status in ('visible', 'pending') and forum_thread_is_visible(thread_id));
create policy "author edits or deletes own reply" on forum_replies for update to forum_app
  using (author_id = forum_current_user() and status in ('visible', 'pending'))
  with check (author_id = forum_current_user() and status in ('visible', 'pending', 'removed-by-author'));
create policy "moderators update replies" on forum_replies for update to forum_app
  using (forum_is_moderator()) with check (forum_is_moderator());
grant select (id, status) on forum_replies to forum_app;
create policy "find own or moderated replies" on forum_replies for select to forum_app
  using (author_id = forum_current_user() or forum_is_moderator());

create view forum_replies_feed as
  select id, thread_id,
         case when anonymous and author_id <> forum_current_user() and not forum_is_moderator() then null else author_id end as author_id,
         body, label, source_url, anonymous, status, created_at, edited_at
  from forum_replies
  where (status = 'visible' and forum_thread_is_visible(thread_id))
     or (author_id = forum_current_user() and status in ('visible', 'pending', 'hidden', 'removed'))
     or forum_is_moderator();

-- "Found this helpful": people see counts and their own marks, never who else marked a post.
grant insert, delete on forum_helpful to forum_app;
grant select (post_id, user_id) on forum_helpful to forum_app;
create policy "see own marks" on forum_helpful for select to forum_app using (user_id = forum_current_user());
create policy "mark helpful" on forum_helpful for insert to forum_app
  with check (user_id = forum_current_user() and forum_post_is_visible(post_id));
create policy "unmark helpful" on forum_helpful for delete to forum_app using (user_id = forum_current_user());

create view forum_helpful_counts as
  select post_id, count(*)::int as helpful_count, bool_or(user_id = forum_current_user()) as marked_by_me
  from forum_helpful
  where forum_post_is_visible(post_id)
  group by post_id;

-- Reports are private: people can file them; only moderators read and resolve them.
grant insert (target_type, target_id, reporter_id, reason, note) on forum_reports to forum_app;
-- Reporters can read only these columns of their own reports. Moderator notes and who
-- resolved a report are read through forum_reports_queue, which only moderators get rows from.
grant select (id, target_type, target_id, reporter_id, reason, note, status, created_at) on forum_reports to forum_app;
grant update (status, resolution, resolved_by, resolved_at, moderator_note) on forum_reports to forum_app;
-- Appeals are only for your own hidden or removed post, once per post.
create policy "file a report" on forum_reports for insert to forum_app
  with check (reporter_id = forum_current_user() and (reason <> 'appeal' or forum_can_appeal(target_type, target_id)));
create policy "read reports" on forum_reports for select to forum_app
  using (reporter_id = forum_current_user() or forum_is_moderator());
create policy "moderators resolve reports" on forum_reports for update to forum_app
  using (forum_is_moderator()) with check (forum_is_moderator());

create view forum_reports_queue as
  select * from forum_reports where forum_is_moderator();

-- One open report per person per post (automatic safety-check reports have no reporter).
create unique index forum_reports_one_open_per_person on forum_reports (target_id, reporter_id)
  where status = 'open' and reporter_id is not null;
-- One appeal per post, even if two arrive at the same moment.
create unique index forum_reports_one_appeal on forum_reports (target_id) where reason = 'appeal';

-- Mutes are private to the person who set them. Moderators can't be muted, so safety notices always get through.
grant select, insert, delete on forum_mutes to forum_app;
create policy "see own mutes" on forum_mutes for select to forum_app using (user_id = forum_current_user());
create policy "mute someone" on forum_mutes for insert to forum_app
  with check (user_id = forum_current_user() and not forum_user_is_moderator(muted_user_id));
create policy "unmute someone" on forum_mutes for delete to forum_app using (user_id = forum_current_user());

grant select on forum_profiles_feed, forum_threads_feed, forum_replies_feed,
  forum_helpful_counts, forum_reports_queue to forum_app;

-- ---------- rules the database enforces itself ----------
-- The app checks these too, but a modified app could skip its own checks, so the
-- database repeats them. A trusted connection (forum_current_user() is null: an
-- admin script, a migration, the psql prompt) skips them.

-- Server copy of the "hold for review" check in forum/assets/js/safety.js. Keep the two lists in step.
create or replace function forum_needs_review(txt text)
returns boolean language sql immutable as $$
  select coalesce(txt, '') ~* any (array[
    '\ycure[sd]?\y',
    '\ystop (taking |going to |seeing )?(your |my |the )?(chemo|chemotherapy|medication|meds|treatment|doctor|oncologist)',
    'instead of (chemo|chemotherapy|treatment|your doctor|your oncologist|medication)',
    '\y(guaranteed|proven) to (heal|fix|cure|reverse)',
    '\yrevers(e|es|ed) (neuropathy|chemo brain|nerve damage)',
    '\ydon''?t need (a |your )?(doctor|oncologist|treatment)'
  ]);
$$;

-- Runs before every new or changed conversation or reply.
create or replace function forum_guard_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  post_text text := coalesce(to_jsonb(new) ->> 'title', '') || ' ' || new.body;
  text_changed boolean := tg_op = 'INSERT'
    or new.body is distinct from old.body
    or (to_jsonb(new) ->> 'title') is distinct from (to_jsonb(old) ->> 'title');
begin
  -- Trusted callers: no signed-in user, or another forum trigger (like auto-hide after 3 reports).
  if forum_current_user() is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  -- "Professional guidance" is for verified professionals only, always under their name.
  if new.label = 'professional' and (new.anonymous or not exists (
      select 1 from forum_profiles
      where user_id = new.author_id and role = 'professional' and pro_verified)) then
    raise exception 'Only verified professionals can post professional guidance, and never anonymously.';
  end if;

  if forum_is_moderator() and tg_op = 'UPDATE' then
    return new;
  end if;

  -- Only moderators decide visibility. Authors may only delete their own post.
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status <> 'removed-by-author' then
    raise exception 'Only moderators can change whether a post is visible.';
  end if;

  if tg_op = 'UPDATE' and text_changed then
    -- Keeps the text people reported in place until a moderator has seen it.
    if exists (select 1 from forum_reports where target_id = new.id and status = 'open'
               and reporter_id is not null and reason <> 'appeal') then
      raise exception 'This post can''t be edited while a moderator reviews a report about it.';
    end if;
    new.edited_at := now();
  end if;

  -- Possible unsafe medical claims wait for a moderator, whatever status the app asked for.
  if text_changed and forum_needs_review(post_text) and new.status in ('visible', 'pending') then
    new.status := 'pending';
    if not exists (select 1 from forum_reports
                   where target_id = new.id and status = 'open' and reporter_id is null) then
      insert into forum_reports (target_type, target_id, reporter_id, reason, note)
      values (case when tg_table_name = 'forum_threads' then 'thread' else 'reply' end, new.id, null,
              'unsafe-medical', 'Held automatically: the safety check flagged a possible unsafe medical claim.');
    end if;
  end if;
  return new;
end;
$$;

create trigger forum_threads_guard before insert or update on forum_threads
  for each row execute function forum_guard_post();
create trigger forum_replies_guard before insert or update on forum_replies
  for each row execute function forum_guard_post();

-- Runs after every new report: checks the post exists, and hides it once 3 different people report it.
create or replace function forum_after_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  reporters int;
begin
  if pg_trigger_depth() > 1 then
    return new; -- the automatic safety-check report, filed while its post is being saved
  end if;
  if new.target_type = 'thread' and not exists (select 1 from forum_threads where id = new.target_id)
     or new.target_type = 'reply' and not exists (select 1 from forum_replies where id = new.target_id) then
    raise exception 'That post no longer exists.';
  end if;
  if new.reason = 'appeal' then
    return new;
  end if;
  -- Reports are for visible posts by other people (authors use edit, delete or an appeal).
  if not forum_post_is_visible(new.target_id) then
    raise exception 'That post no longer exists.';
  end if;
  if exists (select 1 from forum_threads where id = new.target_id and author_id = new.reporter_id)
     or exists (select 1 from forum_replies where id = new.target_id and author_id = new.reporter_id) then
    raise exception 'You can''t report your own post.';
  end if;
  select count(distinct reporter_id) into reporters from forum_reports
  where target_id = new.target_id and status = 'open' and reporter_id is not null and reason <> 'appeal';
  if reporters >= 3 then
    if new.target_type = 'thread' then
      update forum_threads set status = 'hidden' where id = new.target_id and status = 'visible';
    else
      update forum_replies set status = 'hidden' where id = new.target_id and status = 'visible';
    end if;
  end if;
  return new;
end;
$$;

create trigger forum_reports_after_insert after insert on forum_reports
  for each row execute function forum_after_report();

-- Still to decide with the team before this goes live:
-- 1. forum_needs_review copies the app's hold patterns from forum/assets/js/safety.js.
--    If the team changes one list, change the other.
-- 2. Muting is applied by the app when it reads the feed (anonymous posts are
--    never muted, because hiding one would reveal who wrote it).
-- 3. Your API server must `set local role forum_app` and `set local forum.current_account`
--    per request (see the header). Connecting as a superuser or the table owner
--    bypasses row level security, so the forum's own login role must not own these tables.
