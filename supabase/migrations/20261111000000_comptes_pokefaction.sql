-- Comptes PokéFaction : protège les pseudos du serveur (online-mode=false).
-- Le launcher crée/connecte un compte, puis demande un « ticket » à chaque JOUER ;
-- le serveur (mod pokefaction-core) vérifie ce ticket quand le joueur se connecte.
-- Toute l'API passe par les fonctions pf_* ci-dessous (clé publique) ; les tables ne sont pas accessibles directement.

create extension if not exists pgcrypto with schema extensions;

create table public.comptes (
    id uuid primary key default gen_random_uuid(),
    pseudo text not null check (pseudo ~ '^[A-Za-z0-9_]{3,16}$'),
    type text not null check (type in ('pokefaction', 'microsoft')),
    mot_de_passe text,               -- bcrypt (comptes pokefaction)
    microsoft_uuid uuid unique,      -- comptes microsoft
    echecs int not null default 0,
    dernier_echec timestamptz,
    cree_le timestamptz not null default now(),
    derniere_connexion timestamptz,
    check ((type = 'pokefaction') = (mot_de_passe is not null)),
    check ((type = 'microsoft') = (microsoft_uuid is not null))
);
create unique index comptes_pseudo_unique on public.comptes (lower(pseudo));

create table public.sessions (
    jeton_hash text primary key,     -- sha256 du jeton de session (le launcher garde le jeton)
    compte_id uuid not null references public.comptes(id) on delete cascade,
    expire_le timestamptz not null
);
create index sessions_compte on public.sessions (compte_id);

create table public.tickets (
    ticket_hash text primary key,    -- sha256 du ticket de jeu (le jeu le présente au serveur)
    compte_id uuid not null references public.comptes(id) on delete cascade,
    expire_le timestamptz not null
);
create index tickets_compte on public.tickets (compte_id);

create table public.parametres (
    nom text primary key,
    valeur text not null
);

alter table public.comptes enable row level security;
alter table public.sessions enable row level security;
alter table public.tickets enable row level security;
alter table public.parametres enable row level security;
revoke all on public.comptes, public.sessions, public.tickets, public.parametres from anon, authenticated;

-- ---------------------------------------------------------------- outils internes
create function public.pf_hash(texte text) returns text
language sql immutable set search_path = '' as $$
    select encode(extensions.digest(texte, 'sha256'), 'hex')
$$;

create function public.pf_jeton() returns text
language sql volatile set search_path = '' as $$
    select encode(extensions.gen_random_bytes(32), 'hex')
$$;

create function public.pf_nouvelle_session(p_compte uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare
    jeton text := public.pf_jeton();
    c public.comptes;
begin
    delete from public.sessions where compte_id = p_compte and expire_le < now();
    insert into public.sessions (jeton_hash, compte_id, expire_le)
        values (public.pf_hash(jeton), p_compte, now() + interval '180 days');
    select * into c from public.comptes where id = p_compte;
    return json_build_object('session', jeton, 'pseudo', c.pseudo, 'type', c.type);
end $$;

create function public.pf_verifier_admin(p_cle text) returns void
language plpgsql security definer set search_path = '' as $$
begin
    if p_cle is null or not exists (
        select 1 from public.parametres where nom = 'cle_admin_hash' and valeur = public.pf_hash(p_cle)
    ) then
        raise exception 'Clé admin invalide.';
    end if;
end $$;

-- ---------------------------------------------------------------- API du launcher
create function public.pf_inscription(p_pseudo text, p_mot_de_passe text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    nouvel_id uuid;
begin
    if p_pseudo is null or p_pseudo !~ '^[A-Za-z0-9_]{3,16}$' then
        raise exception 'Pseudo invalide : 3 à 16 caractères, lettres, chiffres et _ seulement.';
    end if;
    if p_mot_de_passe is null or length(p_mot_de_passe) < 6 then
        raise exception 'Mot de passe trop court : 6 caractères minimum.';
    end if;
    if exists (select 1 from public.comptes where lower(pseudo) = lower(p_pseudo)) then
        raise exception 'Ce pseudo est déjà pris.';
    end if;
    insert into public.comptes (pseudo, type, mot_de_passe)
        values (p_pseudo, 'pokefaction', extensions.crypt(p_mot_de_passe, extensions.gen_salt('bf', 10)))
        returning id into nouvel_id;
    return public.pf_nouvelle_session(nouvel_id);
exception when unique_violation then
    raise exception 'Ce pseudo est déjà pris.';
end $$;

create function public.pf_connexion(p_pseudo text, p_mot_de_passe text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
begin
    select * into c from public.comptes where lower(pseudo) = lower(coalesce(p_pseudo, ''));
    if not found then
        raise exception 'Pseudo ou mot de passe incorrect.';
    end if;
    if c.type <> 'pokefaction' then
        raise exception 'Ce compte utilise la connexion Microsoft.';
    end if;
    if c.echecs >= 10 and c.dernier_echec > now() - interval '15 minutes' then
        raise exception 'Trop d''essais ratés. Réessaie dans 15 minutes.';
    end if;
    if c.mot_de_passe <> extensions.crypt(coalesce(p_mot_de_passe, ''), c.mot_de_passe) then
        update public.comptes
            set echecs = case when dernier_echec < now() - interval '15 minutes' then 1 else echecs + 1 end,
                dernier_echec = now()
            where id = c.id;
        -- on garde la mise à jour du compteur malgré l'erreur : réponse normale + message
        return json_build_object('erreur', 'Pseudo ou mot de passe incorrect.');
    end if;
    update public.comptes set echecs = 0 where id = c.id;
    return public.pf_nouvelle_session(c.id);
end $$;

create function public.pf_session_compte(p_session text) returns public.comptes
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
begin
    select co.* into c from public.sessions s join public.comptes co on co.id = s.compte_id
        where s.jeton_hash = public.pf_hash(coalesce(p_session, '')) and s.expire_le > now();
    if not found then
        raise exception 'Session expirée : reconnecte-toi.';
    end if;
    return c;
end $$;

create function public.pf_moi(p_session text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes := public.pf_session_compte(p_session);
begin
    return json_build_object('pseudo', c.pseudo, 'type', c.type);
end $$;

create function public.pf_ticket(p_session text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes := public.pf_session_compte(p_session);
    ticket text := public.pf_jeton();
begin
    delete from public.tickets where compte_id = c.id;
    insert into public.tickets (ticket_hash, compte_id, expire_le)
        values (public.pf_hash(ticket), c.id, now() + interval '12 hours');
    return json_build_object('ticket', ticket, 'pseudo', c.pseudo);
end $$;

create function public.pf_deconnexion(p_session text) returns void
language sql security definer set search_path = '' as $$
    delete from public.sessions where jeton_hash = public.pf_hash(coalesce(p_session, ''));
$$;

create function public.pf_changer_mot_de_passe(p_session text, p_nouveau text) returns void
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes := public.pf_session_compte(p_session);
begin
    if c.type <> 'pokefaction' then raise exception 'Ce compte utilise la connexion Microsoft.'; end if;
    if p_nouveau is null or length(p_nouveau) < 6 then
        raise exception 'Mot de passe trop court : 6 caractères minimum.';
    end if;
    update public.comptes set mot_de_passe = extensions.crypt(p_nouveau, extensions.gen_salt('bf', 10)) where id = c.id;
end $$;

-- ---------------------------------------------------------------- API du serveur Minecraft
create function public.pf_verifier_ticket(p_pseudo text, p_ticket text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
    cid uuid;
begin
    select t.compte_id into cid from public.tickets t join public.comptes c on c.id = t.compte_id
        where t.ticket_hash = public.pf_hash(coalesce(p_ticket, ''))
          and t.expire_le > now()
          and lower(c.pseudo) = lower(coalesce(p_pseudo, ''));
    if cid is null then return false; end if;
    update public.comptes set derniere_connexion = now() where id = cid;
    return true;
end $$;

-- Appelé chaque jour par le serveur : garde le projet Supabase gratuit éveillé et fait le ménage.
create function public.pf_ping() returns text
language plpgsql security definer set search_path = '' as $$
begin
    delete from public.tickets where expire_le < now();
    delete from public.sessions where expire_le < now();
    return 'ok';
end $$;

-- ---------------------------------------------------------------- commandes admin (/pfcompte)
create function public.pf_admin_infos(p_cle text, p_pseudo text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
begin
    perform public.pf_verifier_admin(p_cle);
    select * into c from public.comptes where lower(pseudo) = lower(p_pseudo);
    if not found then return null; end if;
    return json_build_object('pseudo', c.pseudo, 'type', c.type, 'cree_le', c.cree_le,
                             'derniere_connexion', c.derniere_connexion);
end $$;

create function public.pf_admin_reinitialiser(p_cle text, p_pseudo text) returns text
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
    provisoire text := substr(public.pf_jeton(), 1, 8);
begin
    perform public.pf_verifier_admin(p_cle);
    select * into c from public.comptes where lower(pseudo) = lower(p_pseudo);
    if not found then raise exception 'Aucun compte « % ».', p_pseudo; end if;
    if c.type <> 'pokefaction' then raise exception 'Ce compte utilise Microsoft : pas de mot de passe.'; end if;
    update public.comptes set mot_de_passe = extensions.crypt(provisoire, extensions.gen_salt('bf', 10)), echecs = 0
        where id = c.id;
    delete from public.sessions where compte_id = c.id;
    delete from public.tickets where compte_id = c.id;
    return provisoire;
end $$;

create function public.pf_admin_supprimer(p_cle text, p_pseudo text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
    perform public.pf_verifier_admin(p_cle);
    delete from public.comptes where lower(pseudo) = lower(p_pseudo);
    return found;
end $$;

-- ---------------------------------------------------------------- connexion Microsoft (Edge Function seulement)
-- L'Edge Function « connexion-microsoft » vérifie le jeton Microsoft auprès de Minecraft, puis appelle ceci.
create function public.pf_microsoft_interne(p_uuid uuid, p_nom text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
    autre public.comptes;
begin
    select * into c from public.comptes where microsoft_uuid = p_uuid;
    select * into autre from public.comptes where lower(pseudo) = lower(p_nom) and (c.id is null or id <> c.id);
    if autre.id is not null then
        raise exception 'Le pseudo % est déjà utilisé par un autre compte PokéFaction. Demande à un admin.', p_nom;
    end if;
    if c.id is null then
        insert into public.comptes (pseudo, type, microsoft_uuid) values (p_nom, 'microsoft', p_uuid) returning * into c;
    elsif c.pseudo <> p_nom then
        update public.comptes set pseudo = p_nom where id = c.id;  -- pseudo Minecraft changé
    end if;
    return public.pf_nouvelle_session(c.id);
end $$;

-- ---------------------------------------------------------------- droits
-- Par défaut Supabase autorise anon/authenticated à exécuter les fonctions : on ferme tout,
-- puis on ouvre seulement l'API publique.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
    public.pf_inscription(text, text),
    public.pf_connexion(text, text),
    public.pf_moi(text),
    public.pf_ticket(text),
    public.pf_deconnexion(text),
    public.pf_changer_mot_de_passe(text, text),
    public.pf_verifier_ticket(text, text),
    public.pf_ping(),
    public.pf_admin_infos(text, text),
    public.pf_admin_reinitialiser(text, text),
    public.pf_admin_supprimer(text, text)
to anon, authenticated;
grant execute on function public.pf_microsoft_interne(uuid, text) to service_role;
