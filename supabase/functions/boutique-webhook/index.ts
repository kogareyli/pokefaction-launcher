// Boutique PokéFaction : Stripe nous prévient qu'un paiement est fait (checkout.session.completed).
// On vérifie la signature (secret STRIPE_WEBHOOK_SECRET), puis la commande passe « payée » : le serveur Minecraft
// la livre tout seul (grade, passe, cosmétiques) à la prochaine connexion du joueur.
import { createClient } from "jsr:@supabase/supabase-js@2";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function signatureValide(corps: string, entete: string, secret: string): Promise<boolean> {
  const morceaux = Object.fromEntries(entete.split(",").map((p) => p.split("=") as [string, string]));
  const t = morceaux["t"], v1 = entete.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || v1.length === 0 || Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const attendu = hex(await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(`${t}.${corps}`)));
  return v1.includes(attendu);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Méthode non autorisée", { status: 405 });
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return new Response("Boutique pas encore configurée", { status: 503 });
  const corps = await req.text();
  if (!(await signatureValide(corps, req.headers.get("stripe-signature") ?? "", secret))) return new Response("Signature invalide", { status: 400 });
  const ev = JSON.parse(corps);
  if (ev.type === "checkout.session.completed" && ev.data?.object?.payment_status === "paid") {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await admin.rpc("pf_commande_payee", { p_stripe: ev.data.object.id });
    if (error) return new Response("Erreur : " + error.message, { status: 500 });
  }
  return new Response("ok");
});
