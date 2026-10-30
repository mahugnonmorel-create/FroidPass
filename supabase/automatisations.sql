-- FroidPass — table de suivi des e-mails automatiques (à exécuter UNE FOIS dans Supabase > SQL Editor)
create table if not exists public.notifications_envoyees (
  id             uuid primary key default gen_random_uuid(),
  technicien_id  uuid not null references public.techniciens(id) on delete cascade,
  type           text not null,
  ref            text not null default '',
  created_at     timestamptz not null default now(),
  unique (technicien_id, type, ref)
);
alter table public.notifications_envoyees enable row level security;
-- Aucune politique : seul le serveur (clé service_role) lit et écrit cette table.
