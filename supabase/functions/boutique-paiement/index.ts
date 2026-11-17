// Boutique PokéFaction : crée la page de paiement Stripe d'une commande (créée avant par pf_commande_creer).
// Le joueur envoie { session, commande } ; on vérifie que c'est bien SA commande (pf_commande_pour_paiement),
// puis on demande à Stripe une session Checkout. Sans clé Stripe (secret STRIPE_SECRET_KEY pas encore mis par Eddy) :
// « Paiement bientôt disponible ».
import { createClient } from "jsr:@supabase/supabase-js@2";

const entetes = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Content-Type": "application/json",
};
const reponse = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: entetes });
const SITE = Deno.env.get("SITE_URL") ?? "https://www.xn--pokfaction-d7a.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: entetes });
  if (req.method !== "POST") return reponse({ erreur: "Méthode non autorisée." }, 405);
  let session = "", commande = "";
  try {
    ({ session, commande } = await req.json());
  } catch {
    return reponse({ erreur: "Requête invalide." }, 400);
  }
  if (typeof session !== "string" || !/^[0-9a-f-]{36}$/.test(commande ?? "")) return reponse({ erreur: "Requête invalide." }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: cmd, error } = await admin.rpc("pf_commande_pour_paiement", { p_session: session, p_id: commande });
  if (error) return reponse({ erreur: error.message }, 400);

  const cle = Deno.env.get("STRIPE_SECRET_KEY");
  if (!cle) return reponse({ erreur: "Paiement bientôt disponible : la boutique ouvre très vite !" }, 503);

  const f = new URLSearchParams();
  f.set("mode", "payment");
  f.set("success_url", `${SITE}/boutique/merci?commande=${cmd.id}`);
  f.set("cancel_url", `${SITE}/boutique?annule=1`);
  f.set("client_reference_id", cmd.id);
  f.set("metadata[commande]", cmd.id);
  f.set("metadata[pseudo]", cmd.pseudo);
  f.set("locale", "fr");
  (cmd.lignes as { nom: string; prix: number }[]).forEach((l, i) => {
    f.set(`line_items[${i}][quantity]`, "1");
    f.set(`line_items[${i}][price_data][currency]`, "eur");
    f.set(`line_items[${i}][price_data][unit_amount]`, String(l.prix));
    f.set(`line_items[${i}][price_data][product_data][name]`, `${l.nom} (PokéFaction, pour ${cmd.pseudo})`);
  });
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: f,
  });
  const s = await r.json();
  if (!r.ok || !s.url) return reponse({ erreur: "Stripe a refusé la commande : " + (s.error?.message ?? r.status) }, 502);
  await admin.rpc("pf_commande_stripe", { p_id: cmd.id, p_stripe: s.id });
  return reponse({ url: s.url });
});
