-- =====================================================================
-- FroidPass — Notifications sur le téléphone (Web Push)
-- =====================================================================
-- Réglages serveur (clés VAPID générées automatiquement) : accès serveur uniquement (aucune règle RLS = invisible côté application)
create table if not exists public.config_serveur (
  cle    text primary key,
  valeur jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.config_serveur enable row level security;

-- Appareils abonnés aux notifications (un utilisateur peut en avoir plusieurs)
create table if not exists public.push_abonnements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_id     uuid references public.techniciens(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  appareil   text default '',
  created_at timestamptz not null default now()
);
create index if not exists push_abonnements_user on public.push_abonnements(user_id);
alter table public.push_abonnements enable row level security;
drop policy if exists push_select on public.push_abonnements;
create policy push_select on public.push_abonnements for select using (user_id = auth.uid());
drop policy if exists push_delete on public.push_abonnements;
create policy push_delete on public.push_abonnements for delete using (user_id = auth.uid());
grant select, delete on public.push_abonnements to authenticated;
