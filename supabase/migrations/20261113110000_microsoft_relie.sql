-- Connexion Microsoft = même joueur que le compte PokéFaction du même pseudo (demande d'Eddy, 13/11/2026).
-- Avant : se connecter avec Microsoft alors qu'un compte « mot de passe » portait déjà le pseudo donnait
-- « Le pseudo … est déjà utilisé ». Maintenant :
--   - Mojang confirme que ce compte Microsoft possède le pseudo → il est relié au compte PokéFaction du même
--     pseudo (même compte, mêmes objets en jeu). Le mot de passe reste valable : les deux connexions marchent.
--   - Si un autre compte Microsoft portait ce pseudo (il en a changé chez Mojang), il est renommé « ancien_… »
--     et retrouvera son nouveau pseudo à sa prochaine connexion Microsoft.
-- Un compte peut donc avoir un mot de passe ET un compte Microsoft (au moins l'un des deux).

alter table public.comptes drop constraint if exists comptes_check;
alter table public.comptes drop constraint if exists comptes_check1;
alter table public.comptes add constraint comptes_un_moyen check (mot_de_passe is not null or microsoft_uuid is not null);

create or replace function public.pf_connexion(p_pseudo text, p_mot_de_passe text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
begin
    select * into c from public.comptes where lower(pseudo) = lower(coalesce(p_pseudo, ''));
    if not found then
        raise exception 'Pseudo ou mot de passe incorrect.';
    end if;
    if c.mot_de_passe is null then
        raise exception 'Ce compte se connecte avec Microsoft (bouton Microsoft).';
    end if;
    if c.echecs >= 10 and c.dernier_echec > now() - interval '15 minutes' then
        raise exception 'Trop d''essais ratés. Réessaie dans 15 minutes.';
    end if;
    if c.mot_de_passe <> extensions.crypt(coalesce(p_mot_de_passe, ''), c.mot_de_passe) then
        update public.comptes
            set echecs = case when dernier_echec < now() - interval '15 minutes' then 1 else echecs + 1 end,
                dernier_echec = now()
            where id = c.id;
        return json_build_object('erreur', 'Pseudo ou mot de passe incorrect.');
    end if;
    update public.comptes set echecs = 0 where id = c.id;
    return public.pf_nouvelle_session(c.id);
end $$;

-- Un joueur connecté (mot de passe ou Microsoft) peut choisir un mot de passe
create or replace function public.pf_changer_mot_de_passe(p_session text, p_nouveau text) returns void
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes := public.pf_session_compte(p_session);
begin
    if p_nouveau is null or length(p_nouveau) < 6 then
        raise exception 'Mot de passe trop court : 6 caractères minimum.';
    end if;
    update public.comptes set mot_de_passe = extensions.crypt(p_nouveau, extensions.gen_salt('bf', 10)) where id = c.id;
end $$;

create or replace function public.pf_admin_reinitialiser(p_cle text, p_pseudo text) returns text
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
    provisoire text := substr(public.pf_jeton(), 1, 8);
begin
    perform public.pf_verifier_admin(p_cle);
    select * into c from public.comptes where lower(pseudo) = lower(p_pseudo);
    if not found then raise exception 'Aucun compte « % ».', p_pseudo; end if;
    update public.comptes set mot_de_passe = extensions.crypt(provisoire, extensions.gen_salt('bf', 10)), echecs = 0
        where id = c.id;
    delete from public.sessions where compte_id = c.id;
    delete from public.tickets where compte_id = c.id;
    return provisoire;
end $$;

create or replace function public.pf_microsoft_interne(p_uuid uuid, p_nom text) returns json
language plpgsql security definer set search_path = '' as $$
declare
    c public.comptes;
    autre public.comptes;
begin
    select * into c from public.comptes where microsoft_uuid = p_uuid;
    select * into autre from public.comptes where lower(pseudo) = lower(p_nom) and (c.id is null or id <> c.id);
    if autre.id is not null then
        if c.id is null and autre.microsoft_uuid is null then
            -- Compte PokéFaction du même pseudo, sans Microsoft : c'est le même joueur, on relie
            update public.comptes set microsoft_uuid = p_uuid where id = autre.id;
            return public.pf_nouvelle_session(autre.id);
        end if;
        -- Mojang vient de confirmer que ce compte Microsoft possède le pseudo : l'ancien porteur le libère
        update public.comptes set pseudo = 'ancien_' || substr(replace(autre.id::text, '-', ''), 1, 9) where id = autre.id;
        delete from public.sessions where compte_id = autre.id;
        delete from public.tickets where compte_id = autre.id;
    end if;
    if c.id is null then
        insert into public.comptes (pseudo, type, microsoft_uuid) values (p_nom, 'microsoft', p_uuid) returning * into c;
    elsif c.pseudo <> p_nom then
        update public.comptes set pseudo = p_nom where id = c.id;  -- pseudo Minecraft changé
    end if;
    return public.pf_nouvelle_session(c.id);
end $$;
