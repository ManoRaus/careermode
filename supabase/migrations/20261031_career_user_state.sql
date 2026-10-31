-- Career Mode: etapa 1 - base de dados para contas e sincronizacao.
-- Preparacao apenas: nao executar automaticamente em producao.
-- Auth de email/senha sera gerenciado por Supabase Auth.
-- Nunca armazenar senha, token de sessao ou segredos no payload.

create table if not exists public.career_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint career_user_state_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint career_user_state_no_password check (
    not (payload ? 'password')
    and not (payload ? 'access_token')
    and not (payload ? 'refresh_token')
    and not ((payload->'user') ? 'password')
  )
);

alter table public.career_user_state enable row level security;

drop policy if exists "career_state_select_own" on public.career_user_state;
create policy "career_state_select_own"
on public.career_user_state for select to authenticated
using ((select auth.uid()) = user_id);

-- Escritas passam por RPC com controle de revisao, evitando sobrescrever
-- silenciosamente alteracoes de outro dispositivo.
revoke all on public.career_user_state from anon, authenticated;
grant select on public.career_user_state to authenticated;

create or replace function public.save_career_user_state(
  p_payload jsonb,
  p_expected_revision bigint
)
returns public.career_user_state
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result public.career_user_state;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload ? 'password'
     or p_payload ? 'access_token'
     or p_payload ? 'refresh_token'
     or (p_payload->'user') ? 'password' then
    raise exception 'Invalid payload' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid expected revision' using errcode = '22023';
  end if;

  -- INSERT/UPDATE are authorized by RLS and grants. See grants below.
  insert into public.career_user_state (user_id, payload, revision, updated_at)
  select v_uid, p_payload, 1, now()
  where p_expected_revision = 0
     or exists (select 1 from public.career_user_state where user_id = v_uid)
  on conflict (user_id) do update
    set payload = excluded.payload,
        revision = public.career_user_state.revision + 1,
        updated_at = now()
    where public.career_user_state.revision = p_expected_revision
  returning * into v_result;

  if not found then
    raise exception 'Revision conflict; reload before saving' using errcode = '40001';
  end if;
  return v_result;
end;
$$;

-- RPC is SECURITY INVOKER; policies still restrict each row to its owner.
drop policy if exists "career_state_insert_own" on public.career_user_state;
create policy "career_state_insert_own"
on public.career_user_state for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "career_state_update_own" on public.career_user_state;
create policy "career_state_update_own"
on public.career_user_state for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant insert, update on public.career_user_state to authenticated;
revoke all on function public.save_career_user_state(jsonb, bigint) from public, anon;
grant execute on function public.save_career_user_state(jsonb, bigint) to authenticated;

-- Esta migracao NAO modifica push_subscriptions,
-- notification_schedules, cron, Vault ou Edge Functions.
