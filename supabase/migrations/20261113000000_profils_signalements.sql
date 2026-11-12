-- Profils des joueurs (envoyés par le serveur Minecraft, lus par le launcher)
-- et signalements de bugs (envoyés par le launcher, lus par le PokéFaction Panel).

create table public.profils (
    pseudo_min text primary key,          -- pseudo en minuscules
    pseudo text not null,
    donnees jsonb not null default '{}'::jsonb,
    maj_le timestamptz not null default now()
);

create table public.signalements (
    id bigint generated always as identity primary key,
    compte_id uuid references public.comptes(id) on delete set null,
    pseudo text not null,
    texte text not null check (length(texte) between 5 and 2000),
    journal text check (journal is null or length(journal) <= 120000),
    version text check (version is null or length(version) <= 40),
    cree_le timestamptz not null default now(),
    traite boolean not null default false
);
create index signalements_compte on public.signalements (compte_id, cree_le);

alter table public.profils enable row level security;
alter table public.signalements enable row level security;
revoke all on public.profils, public.signalements from anon, authenticated;

-- ---------------------------------------------------------------- serveur Minecraft (clé admin)
-- p_profils : [{ "pseudo": "...", "donnees": { ... } }, ...]
create function public.pf_profils_maj(p_cle text, p_profils jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
    p jsonb;
    n int := 0;
begin
    perform public.pf_verifier_admin(p_cle);
    if jsonb_typeof(p_profils) <> 'array' then
        raise exception 'Liste de profils attendue.';
    end if;
    for p in select * from jsonb_array_elements(p_profils) limit 200 loop
        if (p->>'pseudo') !~ '^[A-Za-z0-9_]{3,16}$' then continue; end if;
        insert into public.profils (pseudo_min, pseudo, donnees, maj_le)
            values (lower(p->>'pseudo'), p->>'pseudo', coalesce(p->'donnees', '{}'::jsonb), now())
            on conflict (pseudo_min) do update set pseudo = excluded.pseudo, donnees = excluded.donnees, maj_le = now();
        n := n + 1;
    end loop;
    return n;
end $$;

-- ---------------------------------------------------------------- launcher (session du compte)
create function public.pf_mon_profil(p_session text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
    pr public.profils;
begin
    c := public.pf_session_compte(p_session);
    select * into pr from public.profils where pseudo_min = lower(c.pseudo);
    if not found then
        return json_build_object('pseudo', c.pseudo, 'aucun', true);
    end if;
    return json_build_object('pseudo', pr.pseudo, 'donnees', pr.donnees, 'maj_le', pr.maj_le);
end $$;

create function public.pf_signaler(p_session text, p_texte text, p_journal text, p_version text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
begin
    c := public.pf_session_compte(p_session);
    if p_texte is null or length(trim(p_texte)) < 5 then
        raise exception 'Explique le problème en quelques mots (5 caractères minimum).';
    end if;
    if (select count(*) from public.signalements where compte_id = c.id and cree_le > now() - interval '1 hour') >= 5 then
        raise exception 'Tu as déjà envoyé 5 signalements cette heure-ci. Réessaie plus tard.';
    end if;
    insert into public.signalements (compte_id, pseudo, texte, journal, version)
        values (c.id, c.pseudo, left(trim(p_texte), 2000), right(p_journal, 120000), left(p_version, 40));
    return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- PokéFaction Panel (clé admin)
create function public.pf_signalements(p_cle text, p_tous boolean) returns json
language plpgsql security definer set search_path = '' as $$
begin
    perform public.pf_verifier_admin(p_cle);
    return coalesce((
        select json_agg(json_build_object('id', s.id, 'pseudo', s.pseudo, 'texte', s.texte, 'journal', s.journal,
                                          'version', s.version, 'cree_le', s.cree_le, 'traite', s.traite) order by s.cree_le desc)
        from (select * from public.signalements where p_tous or not traite order by cree_le desc limit 100) s
    ), '[]'::json);
end $$;

create function public.pf_signalement_traite(p_cle text, p_id bigint, p_traite boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
    perform public.pf_verifier_admin(p_cle);
    update public.signalements set traite = p_traite where id = p_id;
end $$;

-- ---------------------------------------------------------------- droits
revoke execute on function
    public.pf_profils_maj(text, jsonb),
    public.pf_mon_profil(text),
    public.pf_signaler(text, text, text, text),
    public.pf_signalements(text, boolean),
    public.pf_signalement_traite(text, bigint, boolean)
from public, anon, authenticated;
grant execute on function
    public.pf_profils_maj(text, jsonb),
    public.pf_mon_profil(text),
    public.pf_signaler(text, text, text, text),
    public.pf_signalements(text, boolean),
    public.pf_signalement_traite(text, bigint, boolean)
to anon, authenticated;
