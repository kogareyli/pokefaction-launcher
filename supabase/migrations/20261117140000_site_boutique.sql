-- PokéFaction 6.3 (17/11) : connexion au site avec un code donné en jeu (/site) et boutique (commandes payées par Stripe,
-- livrées par le serveur Minecraft). Tout reste cosmétique (règles de Mojang). Les prix sont ici : le site ne fait que les afficher.

create table public.codes_site (
    code_hash text primary key,                 -- sha256 du code à 6 chiffres
    compte_id uuid not null references public.comptes(id) on delete cascade,
    expire_le timestamptz not null
);
create index codes_site_compte on public.codes_site (compte_id);

create table public.essais_codes (
    quand timestamptz not null default now()    -- anti-devinette : 30 essais par minute au plus (tous joueurs)
);

create table public.commandes (
    id uuid primary key default gen_random_uuid(),
    compte_id uuid not null references public.comptes(id) on delete cascade,
    pseudo text not null,
    articles jsonb not null,                    -- ["grade_shiny", "cosm_aureole"]
    total_centimes int not null check (total_centimes > 0),
    statut text not null default 'en_attente' check (statut in ('en_attente', 'payee', 'livree', 'annulee')),
    stripe_session text unique,
    cree_le timestamptz not null default now(),
    payee_le timestamptz,
    livree_le timestamptz
);
create index commandes_compte on public.commandes (compte_id);
create index commandes_statut on public.commandes (statut);

alter table public.codes_site enable row level security;
alter table public.essais_codes enable row level security;
alter table public.commandes enable row level security;
revoke all on public.codes_site, public.essais_codes, public.commandes from anon, authenticated;

-- ---------------------------------------------------------------- catalogue (prix en centimes)
create function public.pf_catalogue() returns jsonb
language sql immutable set search_path = '' as $$
    select '{
      "grade_shiny":    {"nom": "Grade Shiny",            "prix": 2000, "type": "grade"},
      "grade_mega":     {"nom": "Grade Méga",             "prix": 5000, "type": "grade"},
      "grade_rayquaza": {"nom": "Grade Rayquaza",         "prix": 8000, "type": "grade"},
      "passe_premium":  {"nom": "Passe de combat Premium", "prix": 1500, "type": "passe"},
      "cosm_pokeball":  {"nom": "Poké Ball dorée",          "prix": 300,  "type": "cosmetique"},
      "cosm_aureole":   {"nom": "Auréole de Ho-Oh",         "prix": 400,  "type": "cosmetique"},
      "cosm_ailes_or":  {"nom": "Ailes d''Arceus",          "prix": 600,  "type": "cosmetique"},
      "cosm_ailes_rayquaza": {"nom": "Ailes de Rayquaza",   "prix": 600,  "type": "cosmetique"}
    }'::jsonb
$$;

-- ---------------------------------------------------------------- connexion au site par code
-- Le serveur Minecraft (clé admin) crée un code pour un joueur qui tape /site.
create function public.pf_code_site_creer(p_cle text, p_pseudo text) returns text
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
    code text;
begin
    perform public.pf_verifier_admin(p_cle);
    select * into c from public.comptes where lower(pseudo) = lower(p_pseudo);
    if not found then
        raise exception 'Pas de compte PokéFaction pour ce pseudo : connecte-toi une fois avec le launcher.';
    end if;
    delete from public.codes_site where compte_id = c.id or expire_le < now();
    code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0'); -- tirage sûr
    insert into public.codes_site (code_hash, compte_id, expire_le) values (public.pf_hash(code), c.id, now() + interval '10 minutes');
    return code;
end $$;

-- Le site échange le code contre une session (comme une connexion par mot de passe).
create function public.pf_code_site_utiliser(p_code text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    v_compte uuid;
begin
    delete from public.essais_codes where quand < now() - interval '1 minute';
    if (select count(*) from public.essais_codes) >= 30 then
        raise exception 'Trop d''essais, réessaie dans une minute.';
    end if;
    insert into public.essais_codes default values;
    select compte_id into v_compte from public.codes_site where code_hash = public.pf_hash(trim(coalesce(p_code, ''))) and expire_le > now();
    if not found then
        raise exception 'Code invalide ou expiré : tape /site en jeu pour en avoir un nouveau.';
    end if;
    delete from public.codes_site where compte_id = v_compte;
    update public.comptes set derniere_connexion = now() where comptes.id = v_compte;
    return public.pf_nouvelle_session(v_compte);
end $$;

-- ---------------------------------------------------------------- commandes
create function public.pf_commande_creer(p_session text, p_articles jsonb) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes := public.pf_session_compte(p_session);
    cat jsonb := public.pf_catalogue();
    a text;
    total int := 0;
    liste jsonb := '[]'::jsonb;
    nouveau uuid;
begin
    if p_articles is null or jsonb_typeof(p_articles) <> 'array' or jsonb_array_length(p_articles) = 0 or jsonb_array_length(p_articles) > 10 then
        raise exception 'Panier vide ou invalide.';
    end if;
    for a in select distinct jsonb_array_elements_text(p_articles) loop
        if not cat ? a then raise exception 'Article inconnu : %', a; end if;
        total := total + (cat -> a ->> 'prix')::int;
        liste := liste || to_jsonb(a);
    end loop;
    insert into public.commandes (compte_id, pseudo, articles, total_centimes) values (c.id, c.pseudo, liste, total) returning id into nouveau;
    return json_build_object('id', nouveau, 'total', total);
end $$;

create function public.pf_mes_commandes(p_session text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes := public.pf_session_compte(p_session);
begin
    return coalesce((select json_agg(json_build_object('id', id, 'articles', articles, 'total', total_centimes, 'statut', statut, 'date', cree_le) order by cree_le desc)
        from (select * from public.commandes where compte_id = c.id order by cree_le desc limit 20) x), '[]'::json);
end $$;

-- Paiement : appelé par la fonction Edge boutique-paiement avec la session du joueur (sa commande seulement).
create function public.pf_commande_pour_paiement(p_session text, p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes := public.pf_session_compte(p_session);
    cmd public.commandes;
    cat jsonb := public.pf_catalogue();
begin
    select * into cmd from public.commandes where id = p_id and compte_id = c.id and statut = 'en_attente';
    if not found then raise exception 'Commande introuvable ou déjà payée.'; end if;
    return json_build_object('id', cmd.id, 'pseudo', cmd.pseudo,
        'lignes', (select json_agg(json_build_object('nom', cat -> x ->> 'nom', 'prix', (cat -> x ->> 'prix')::int)) from jsonb_array_elements_text(cmd.articles) x));
end $$;

-- Réservées à la fonction Edge (service_role) : lier la session Stripe, marquer payée.
create function public.pf_commande_stripe(p_id uuid, p_stripe text) returns void
language sql security definer set search_path = '' as $$
    update public.commandes set stripe_session = p_stripe where id = p_id and statut = 'en_attente'
$$;

create function public.pf_commande_payee(p_stripe text) returns void
language sql security definer set search_path = '' as $$
    update public.commandes set statut = 'payee', payee_le = now() where stripe_session = p_stripe and statut = 'en_attente'
$$;

-- ---------------------------------------------------------------- livraison (serveur Minecraft, clé admin)
create function public.pf_commandes_a_livrer(p_cle text) returns json
language plpgsql security definer set search_path = '' as $$
begin
    perform public.pf_verifier_admin(p_cle);
    return coalesce((select json_agg(json_build_object('id', id, 'pseudo', pseudo, 'articles', articles)) from public.commandes where statut = 'payee'), '[]'::json);
end $$;

create function public.pf_commande_livree(p_cle text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
    perform public.pf_verifier_admin(p_cle);
    update public.commandes set statut = 'livree', livree_le = now() where id = p_id and statut = 'payee';
end $$;

revoke execute on function public.pf_catalogue(), public.pf_code_site_creer(text, text), public.pf_code_site_utiliser(text),
    public.pf_commande_creer(text, jsonb), public.pf_mes_commandes(text), public.pf_commande_pour_paiement(text, uuid),
    public.pf_commande_stripe(uuid, text), public.pf_commande_payee(text), public.pf_commandes_a_livrer(text), public.pf_commande_livree(text, uuid)
    from public, anon, authenticated;
grant execute on function public.pf_catalogue(), public.pf_code_site_creer(text, text), public.pf_code_site_utiliser(text),
    public.pf_commande_creer(text, jsonb), public.pf_mes_commandes(text), public.pf_commande_pour_paiement(text, uuid),
    public.pf_commandes_a_livrer(text), public.pf_commande_livree(text, uuid)
    to anon, authenticated;
grant execute on function public.pf_commande_stripe(uuid, text), public.pf_commande_payee(text), public.pf_commande_pour_paiement(text, uuid) to service_role;
