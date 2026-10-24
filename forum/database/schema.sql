-- Chemoasis forum: DRAFT of separate Postgres tables. Not used yet.
-- The live forum is one shared document in forum_state (server/forum.js), which is simpler and
-- fine at the size the site will realistically reach. If the forum outgrows it, these tables are
-- the next step: the same rules, enforced by the database itself. Tested on PostgreSQL 16.
--
-- Identity: every forum row points at users(id), the accounts the sign-in server creates
-- (server/migrations/001_accounts.sql). Deleting an account deletes its posts.
--
-- "Who is asking?": the server would open a transaction per request and, before any forum
-- query, run
--     set local role forum_app;
--     set local forum.current_account = '<the signed-in person''s uuid>';
-- forum_current_user() reads that setting.
--
-- Fails closed: a connection that sets neither a person nor the trusted flag can't write
-- anything to the forum. Admin scripts (making someone a moderator, fixing a post by hand)
-- must say so explicitly, inside their transaction:
--     set local forum.trusted = 'on';

-- The role the API runs forum queries as. It is a NOLOGIN group role: the connection
-- role switches to it per request, so forum queries never run with more rights than
-- these grants allow. Railway's default login is a superuser, which can always switch.
-- Any other login needs membership; if it can't grant that to itself, a database admin
-- runs `grant forum_app to <login>` once, then the migration is run again.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'forum_app') then
    create role forum_app nologin;
  end if;
  if not pg_has_role(current_user, 'forum_app', 'member') then
    execute format('grant forum_app to %I', current_user);
  end if;
exception when insufficient_privilege then
  raise exception 'The database login % can''t use the forum_app role.', current_user
    using hint = format('Ask a database admin to run: grant forum_app to %I;', current_user);
end $$;

-- The signed-in person for this request, or null.
create or replace function forum_current_user()
returns uuid language sql stable as $$
  select nullif(current_setting('forum.current_account', true), '')::uuid;
$$;

-- True only when an admin script has explicitly said it is trusted.
create or replace function forum_is_trusted()
returns boolean language sql stable as $$
  select coalesce(current_setting('forum.trusted', true), '') = 'on';
$$;

-- Who someone is in the forum. Roles and verification are set only by the team
-- (a trusted script), never by the user, so nobody can give themselves a badge.
create table forum_profiles (
  user_id uuid primary key references users (id) on delete cascade,
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
  author_id uuid not null references users (id) on delete cascade,
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
  author_id uuid not null references users (id) on delete cascade,
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
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table forum_reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('thread', 'reply')),
  target_id uuid not null,
  -- null = the automatic safety check. Deleting an account deletes the reports it filed.
  reporter_id uuid references users (id) on delete cascade,
  -- 'support' = someone may need support (never hides a post).
  -- 'appeal' = the author asking for another review of their own hidden or removed post.
  reason text not null check (reason in ('support', 'unsafe-medical', 'misinformation', 'harassment', 'privacy', 'spam', 'other', 'appeal')),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  -- 'author-deleted' = closed because the author deleted the post.
  resolution text check (resolution in ('keep', 'hide', 'remove', 'author-deleted')),
  resolved_by uuid references users (id) on delete set null,
  resolved_at timestamptz,
  moderator_note text,
  created_at timestamptz not null default now()
);

-- Muting: hides someone's named posts from you only. The muted person isn't told.
create table forum_mutes (
  user_id uuid not null references users (id) on delete cascade,
  muted_user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted_user_id),
  check (user_id <> muted_user_id)
);

create index on forum_threads (category_id, created_at desc);
create index on forum_threads (author_id);
create index on forum_replies (thread_id, created_at);
create index on forum_replies (author_id);
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

revoke all on forum_profiles, forum_threads, forum_replies,
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

-- For the post's author and moderators only (null for everyone else): how many reports
-- are open on it, and whether the author has asked for another review. The author can't
-- read other people's reports, but needs to know their post is being looked at.
create or replace function forum_review_state(post uuid, out open_reports int, out appealed boolean)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from forum_reports where target_id = post and status = 'open'),
         exists (select 1 from forum_reports where target_id = post and reason = 'appeal')
  where forum_is_moderator()
     or exists (select 1 from forum_threads where id = post and author_id = forum_current_user())
     or exists (select 1 from forum_replies where id = post and author_id = forum_current_user());
$$;

-- Profiles. People edit only their own safe columns; role, verification and
-- credentials are set by the team with a trusted script, never by the user.
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
  where forum_current_user() is not null
    and (status = 'visible'
         or (author_id = forum_current_user() and status in ('pending', 'hidden', 'removed'))
         or forum_is_moderator());

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
  where forum_current_user() is not null
    and ((status = 'visible' and forum_thread_is_visible(thread_id))
         or (author_id = forum_current_user() and status in ('visible', 'pending', 'hidden', 'removed'))
         or forum_is_moderator());

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
  where forum_current_user() is not null and forum_post_is_visible(post_id)
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
-- The app checks these too, but a modified or buggy app could skip its own checks,
-- so the database repeats them. Only a trusted script (forum.trusted = 'on') skips them.

-- Refuses a change when nobody is named: no signed-in person and no trusted flag.
-- Forum triggers that change rows themselves (pg_trigger_depth() > 1) are allowed.
create or replace function forum_require_identity()
returns trigger language plpgsql as $$
begin
  if forum_current_user() is null and not forum_is_trusted() and pg_trigger_depth() <= 1 then
    raise exception 'Forum changes need a signed-in person (forum.current_account) or an explicitly trusted script (forum.trusted = on).'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger forum_profiles_identity before insert or update or delete on forum_profiles
  for each row execute function forum_require_identity();
create trigger forum_helpful_identity before insert or update or delete on forum_helpful
  for each row execute function forum_require_identity();
create trigger forum_mutes_identity before insert or update or delete on forum_mutes
  for each row execute function forum_require_identity();
create trigger forum_threads_identity before delete on forum_threads
  for each row execute function forum_require_identity();
create trigger forum_replies_identity before delete on forum_replies
  for each row execute function forum_require_identity();
create trigger forum_reports_identity before update or delete on forum_reports
  for each row execute function forum_require_identity();

-- Server copy of the "hold for review" check in forum/assets/js/safety.js. Keep the two lists in step.
create or replace function forum_needs_review(txt text)
returns boolean language sql immutable as $$
  select coalesce(txt, '') ~* any (array[
    '\ycure[sd]?\y',
    '\ystop (taking |going to |seeing )?(your |my |the )?(chemo|chemotherapy|medication|meds|treatment|doctor|oncologist)',
    'instead of (chemo|chemotherapy|treatment|your doctor|your oncologist|medication)',
    '\y(guaranteed|proven) to (heal|fix|cure|reverse)',
    '\yrevers(e|es|ed) (neuropathy|chemo brain|nerve damage)',
    '\ydon[''’]?t need (a |your )?(doctor|oncologist|treatment)'
  ]);
$$;

-- Server copy of the "crisis" check in forum/assets/js/safety.js. Keep the two lists in step.
create or replace function forum_needs_support(txt text)
returns boolean language sql immutable as $$
  select coalesce(txt, '') ~* any (array[
    'suicid',
    '\ykill(ing)? myself',
    '\yend(ing)? (my life|it all)\y',
    '\yself[- ]?harm',
    '\y(hurt(ing)?|harm(ing)?|cut(ting)?) myself',
    '\ywant(ed|ing)? to die\y',
    '\ywish(ed)? i (was|were) dead\y',
    '\ybetter off (dead|without me)\y',
    '\yno reason to (live|go on|keep going)\y',
    '\ynot worth living\y',
    '\ycan[''’]?t go on\y',
    '\ydon[''’]?t want to (be here|live|wake up)',
    '\yoverdos(e|ed|ing)\y'
  ]);
$$;

-- Files the safety check's own report on a post, once while it's open.
create or replace function forum_file_automatic_report(kind text, post uuid, why text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from forum_reports
                 where target_id = post and status = 'open' and reporter_id is null and reason = why) then
    insert into forum_reports (target_type, target_id, reporter_id, reason, note)
    values (kind, post, null, why, case why
      when 'support' then 'Flagged automatically: this post may come from someone who needs support. It is still visible.'
      else 'Held automatically: the safety check flagged a possible unsafe medical claim.' end);
  end if;
end;
$$;

-- Runs before every new or changed conversation or reply.
create or replace function forum_guard_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  kind text := case when tg_table_name = 'forum_threads' then 'thread' else 'reply' end;
  post_text text := coalesce(to_jsonb(new) ->> 'title', '') || ' ' || new.body;
  text_changed boolean := tg_op = 'INSERT'
    or new.body is distinct from old.body
    or (to_jsonb(new) ->> 'title') is distinct from (to_jsonb(old) ->> 'title');
begin
  -- Another forum trigger (like auto-hide after 3 reports) is changing this row.
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  -- Fail closed: nobody named means no change, unless an admin script said it's trusted.
  if forum_current_user() is null then
    if forum_is_trusted() then
      return new;
    end if;
    raise exception 'Forum changes need a signed-in person (forum.current_account) or an explicitly trusted script (forum.trusted = on).'
      using errcode = 'insufficient_privilege';
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
               and reporter_id is not null and reason not in ('appeal', 'support')) then
      raise exception 'This post can''t be edited while a moderator reviews a report about it.';
    end if;
    new.edited_at := now();
  end if;

  if text_changed and new.status in ('visible', 'pending') then
    -- Possible unsafe medical claims wait for a moderator, whatever status the app asked for.
    if forum_needs_review(post_text) then
      new.status := 'pending';
      perform forum_file_automatic_report(kind, new.id, 'unsafe-medical');
    end if;
    -- Possible crisis language stays up (the person may need replies now) and goes to the
    -- top of the moderators' queue.
    if forum_needs_support(post_text) then
      perform forum_file_automatic_report(kind, new.id, 'support');
    end if;
  end if;
  return new;
end;
$$;

create trigger forum_threads_guard before insert or update on forum_threads
  for each row execute function forum_guard_post();
create trigger forum_replies_guard before insert or update on forum_replies
  for each row execute function forum_guard_post();

-- When an author deletes their post nobody can see it any more, so its open reports
-- are closed rather than left for a moderator to undo.
create or replace function forum_after_post_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'removed-by-author' and old.status is distinct from 'removed-by-author' then
    update forum_reports set status = 'dismissed', resolution = 'author-deleted', resolved_at = now()
    where target_id = new.id and status = 'open';
  end if;
  return null;
end;
$$;

create trigger forum_threads_after_update after update on forum_threads
  for each row execute function forum_after_post_change();
create trigger forum_replies_after_update after update on forum_replies
  for each row execute function forum_after_post_change();

-- Runs after every new report: checks the post exists, and hides it once 3 different
-- people have complained about it. "Someone may need support" reports and appeals never
-- count: hiding a crisis post would leave that person alone.
create or replace function forum_after_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  reporters int;
begin
  if pg_trigger_depth() > 1 then
    return new; -- the automatic safety-check report, filed while its post is being saved
  end if;
  if forum_current_user() is null then
    if forum_is_trusted() then
      return new;
    end if;
    raise exception 'Forum changes need a signed-in person (forum.current_account) or an explicitly trusted script (forum.trusted = on).'
      using errcode = 'insufficient_privilege';
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
    raise exception 'You can''t report your own post. You can edit or delete it instead.';
  end if;
  select count(distinct reporter_id) into reporters from forum_reports
  where target_id = new.target_id and status = 'open' and reporter_id is not null
    and reason not in ('appeal', 'support');
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

-- Notes for the team:
-- 1. forum_needs_review and forum_needs_support copy the phrase lists in
--    forum/assets/js/safety.js. Change both together.
-- 2. Muting is applied by the API when it reads the feed (anonymous posts are
--    never muted, because hiding one would reveal who wrote it).
-- 3. Connecting as a superuser or the table owner bypasses row level security, so the
--    server must always set the role and the person first, as described at the top.
--    The triggers above still refuse writes that name nobody.
