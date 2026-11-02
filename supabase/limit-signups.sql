-- Caps the number of accounts. Change 15 below to adjust the limit, then run in SQL Editor.
create or replace function public.limit_signups()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(10);
  if (select count(*) from auth.users) >= 15 then
    raise exception 'Signup limit reached';
  end if;
  return new;
end $$;

drop trigger if exists limit_signups on auth.users;
create trigger limit_signups
  before insert on auth.users
  for each row execute function public.limit_signups();
