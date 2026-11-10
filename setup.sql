-- Run once in Supabase: SQL Editor -> New query -> paste -> Run
create table if not exists families (
  code        text primary key,
  state       jsonb       not null,
  version     integer     not null default 1,
  updated_at  timestamptz not null default now()
);

-- Lock the table: the browser has no direct access, only the server function (service key) does.
alter table families enable row level security;
