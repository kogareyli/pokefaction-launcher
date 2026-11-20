-- 20/11/2026 : accès au 2e serveur (« sao ») validé par le staff.
-- Eddy : « fais que le serveur, je dois accepter les personnes qui veulent l'installer, dans mon panel ».
-- Le launcher demande l'accès (session du joueur), le PokéFaction Panel accepte ou refuse (clé admin),
-- et le serveur de jeu vérifie à chaque connexion que le pseudo est accepté (clé admin).

create table public.acces_serveurs (
    compte_id uuid not null references public.comptes(id) on delete cascade,
    serveur text not null check (serveur ~ '^[a-z0-9_]{2,20}$'),
    pseudo text not null,
    statut text not null default 'demande' check (statut in ('demande', 'accepte', 'refuse')),
    message text,
    demande_le timestamptz not null default now(),
    decide_le timestamptz,
    primary key (compte_id, serveur)
);
alter table public.acces_serveurs enable row level security;
revoke all on public.acces_serveurs from anon, authenticated;

-- ---------------------------------------------------------------- launcher (session du joueur)
create function public.pf_acces_etat(p_session text, p_serveur text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
    a public.acces_serveurs;
begin
    c := public.pf_session_compte(p_session);
    select * into a from public.acces_serveurs where compte_id = c.id and serveur = p_serveur;
    if not found then return json_build_object('statut', 'aucune'); end if;
    return json_build_object('statut', a.statut, 'demande_le', a.demande_le, 'decide_le', a.decide_le);
end $$;

create function public.pf_acces_demander(p_session text, p_serveur text, p_message text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
    a public.acces_serveurs;
begin
    c := public.pf_session_compte(p_session);
    if p_serveur is null or p_serveur !~ '^[a-z0-9_]{2,20}$' then raise exception 'Serveur inconnu.'; end if;
    select * into a from public.acces_serveurs where compte_id = c.id and serveur = p_serveur;
    if found then
        if a.statut = 'accepte' then return json_build_object('statut', 'accepte'); end if;
        if a.statut = 'demande' then return json_build_object('statut', 'demande'); end if;
        if a.decide_le > now() - interval '24 hours' then
            raise exception 'Ta demande a été refusée. Tu pourras redemander demain.';
        end if;
        update public.acces_serveurs set statut = 'demande', message = left(trim(coalesce(p_message, '')), 300),
            demande_le = now(), decide_le = null, pseudo = c.pseudo
            where compte_id = c.id and serveur = p_serveur;
    else
        insert into public.acces_serveurs (compte_id, serveur, pseudo, message)
            values (c.id, p_serveur, c.pseudo, left(trim(coalesce(p_message, '')), 300));
    end if;
    return json_build_object('statut', 'demande');
end $$;

-- ---------------------------------------------------------------- PokéFaction Panel et serveur de jeu (clé admin)
create function public.pf_acces_liste(p_cle text, p_serveur text) returns json
language plpgsql security definer set search_path = '' as $$
begin
    perform public.pf_verifier_admin(p_cle);
    return coalesce((
        select json_agg(json_build_object('pseudo', a.pseudo, 'statut', a.statut, 'message', a.message,
                                          'demande_le', a.demande_le, 'decide_le', a.decide_le)
                        order by (a.statut = 'demande') desc, a.demande_le desc)
        from public.acces_serveurs a where a.serveur = p_serveur
    ), '[]'::json);
end $$;

-- p_statut : 'accepte', 'refuse' (ou 'demande' pour remettre en attente). Marche aussi sans demande (ajout direct par pseudo).
create function public.pf_acces_decider(p_cle text, p_serveur text, p_pseudo text, p_statut text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
begin
    perform public.pf_verifier_admin(p_cle);
    if p_statut not in ('accepte', 'refuse', 'demande') then raise exception 'Statut inconnu.'; end if;
    select * into c from public.comptes where lower(pseudo) = lower(coalesce(p_pseudo, ''));
    if not found then raise exception 'Aucun compte PokéFaction à ce pseudo.'; end if;
    insert into public.acces_serveurs (compte_id, serveur, pseudo, statut, decide_le)
        values (c.id, p_serveur, c.pseudo, p_statut, case when p_statut = 'demande' then null else now() end)
        on conflict (compte_id, serveur) do update set statut = excluded.statut, decide_le = excluded.decide_le, pseudo = excluded.pseudo;
    return json_build_object('pseudo', c.pseudo, 'statut', p_statut);
end $$;

create function public.pf_acces_verifier(p_cle text, p_serveur text, p_pseudo text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
    perform public.pf_verifier_admin(p_cle);
    return exists (select 1 from public.acces_serveurs a join public.comptes c on c.id = a.compte_id
                   where a.serveur = p_serveur and a.statut = 'accepte' and lower(c.pseudo) = lower(coalesce(p_pseudo, '')));
end $$;

-- ---------------------------------------------------------------- droits
revoke execute on function
    public.pf_acces_etat(text, text),
    public.pf_acces_demander(text, text, text),
    public.pf_acces_liste(text, text),
    public.pf_acces_decider(text, text, text, text),
    public.pf_acces_verifier(text, text, text)
from public, anon, authenticated;
grant execute on function
    public.pf_acces_etat(text, text),
    public.pf_acces_demander(text, text, text),
    public.pf_acces_liste(text, text),
    public.pf_acces_decider(text, text, text, text),
    public.pf_acces_verifier(text, text, text)
to anon, authenticated;

-- le propriétaire du serveur a accès d'office
insert into public.acces_serveurs (compte_id, serveur, pseudo, statut, decide_le)
    select id, 'sao', pseudo, 'accepte', now() from public.comptes where lower(pseudo) = 'starless_kirito'
    on conflict do nothing;
