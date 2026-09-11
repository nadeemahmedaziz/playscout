-- Supabase > SQL Editor > New query mein poori file Run karein.
create table if not exists public.allowed_users (
  email text primary key check (email = lower(email)),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.registered_devices (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  device_hash text not null,
  registered_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

alter table public.allowed_users enable row level security;
alter table public.registered_devices enable row level security;

create or replace function public.claim_device(p_device_hash text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_existing text;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'reason','not_authenticated'); end if;
  if length(p_device_hash) < 32 then return jsonb_build_object('ok',false,'reason','invalid_device'); end if;
  if not exists(select 1 from allowed_users where email=v_email and active=true) then
    return jsonb_build_object('ok',false,'reason','email_not_allowed');
  end if;
  select device_hash into v_existing from registered_devices where user_id=auth.uid();
  if v_existing is null then
    insert into registered_devices(user_id,email,device_hash) values(auth.uid(),v_email,p_device_hash);
    return jsonb_build_object('ok',true,'registered',true);
  end if;
  if v_existing <> p_device_hash then return jsonb_build_object('ok',false,'reason','different_device'); end if;
  update registered_devices set last_seen=now() where user_id=auth.uid();
  return jsonb_build_object('ok',true,'registered',false);
end $$;

revoke all on function public.claim_device(text) from public;
grant execute on function public.claim_device(text) to authenticated;

-- IMPORTANT: Neeche apna login email likhein.
insert into public.allowed_users(email) values ('YOUR-EMAIL@example.com')
on conflict (email) do update set active=true;

-- Device change/reset ke liye SQL Editor mein run karein:
-- delete from public.registered_devices where email='your-email@example.com';
