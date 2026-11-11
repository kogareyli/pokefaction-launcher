// Connexion PokéFaction avec un compte Microsoft (Minecraft officiel).
//
// Même principe qu'un serveur Minecraft en mode « online » : le launcher appelle
// sessionserver.mojang.com/session/minecraft/join avec un défi aléatoire, puis nous envoie
// { pseudo, defi }. On demande à Mojang (hasJoined) si ce joueur a bien rejoint avec ce défi.
// Le jeton Microsoft du joueur ne quitte jamais son PC.
import { createClient } from "jsr:@supabase/supabase-js@2";

const entetes = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Content-Type": "application/json",
};
const reponse = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: entetes });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: entetes });
  if (req.method !== "POST") return reponse({ erreur: "Méthode non autorisée." }, 405);

  let pseudo = "", defi = "";
  try {
    ({ pseudo, defi } = await req.json());
  } catch {
    return reponse({ erreur: "Requête invalide." }, 400);
  }
  if (!/^[A-Za-z0-9_]{3,16}$/.test(pseudo ?? "") || !/^[0-9a-f]{20,64}$/.test(defi ?? "")) {
    return reponse({ erreur: "Requête invalide." }, 400);
  }

  const url = `https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${encodeURIComponent(pseudo)}&serverId=${defi}`;
  const mojang = await fetch(url).catch(() => null);
  if (!mojang) return reponse({ erreur: "Les serveurs de Mojang ne répondent pas, réessaie." }, 502);
  if (mojang.status !== 200) {
    return reponse({ erreur: "Connexion Microsoft non confirmée par Mojang. Réessaie." }, 401);
  }
  const profil = await mojang.json() as { id: string; name: string };
  const uuid = profil.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase.rpc("pf_microsoft_interne", { p_uuid: uuid, p_nom: profil.name });
  if (error) return reponse({ erreur: error.message }, 409);
  return reponse(data);
});
