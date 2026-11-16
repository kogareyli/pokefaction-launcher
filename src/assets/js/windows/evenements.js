/**
 * Launcher 3.4.0 : notifications Windows des événements du serveur (rassemblement, raid, largage…).
 * Le planning de la semaine est lu en ligne (web/evenements.json, fait depuis la config du serveur). Le launcher
 * prévient 10 minutes avant et au début. Quand on ferme le launcher, il reste près de l'horloge pour pouvoir
 * prévenir (clic droit sur l'icône : couper les notifications, ou Quitter pour de bon).
 */
const { app, Notification, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");

const JOURS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
let liste = [];
let deja = new Set();
let icone = null;
let montrerFenetre = () => { };
let quitter = () => app.quit();

const fichierReglage = () => path.join(app.getPath("userData"), "notifications.json");

function lireReglage() {
    try { return JSON.parse(fs.readFileSync(fichierReglage(), "utf8")); } catch { return { actif: true, explique: false }; }
}

function ecrireReglage(r) {
    try { fs.writeFileSync(fichierReglage(), JSON.stringify(r)); } catch { }
}

function actif() { return lireReglage().actif !== false; }

function cheminIcone() {
    return path.join(app.getAppPath(), "src/assets/images/icon/icon.ico");
}

/** Jour (« MONDAY »…) et minute de la journée, heure de Paris. */
function maintenantParis(decalageMin = 0) {
    const d = new Date(Date.now() + decalageMin * 60000);
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
    return { jour: p.weekday.toUpperCase(), minute: Number(p.hour) * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
}

function charger(url) {
    https.get(`${url}/evenements.json?t=${Date.now()}`, { headers: { "User-Agent": "PokeFaction-Launcher" } }, res => {
        if (res.statusCode !== 200) { res.resume(); return; }
        let t = "";
        res.setEncoding("utf8");
        res.on("data", c => t += c);
        res.on("end", () => { try { liste = JSON.parse(t).evenements || []; } catch { } });
    }).on("error", () => { });
}

function notifier(titre, texte) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: titre, body: texte, icon: nativeImage.createFromPath(cheminIcone()), silent: false });
    n.on("click", () => montrerFenetre());
    n.show();
}

function verifier() {
    if (!actif() || !liste.length) return;
    for (const [avance, prefixe] of [[10, "Dans 10 min : "], [0, ""]]) {
        const m = maintenantParis(avance);
        for (const e of liste) {
            const [h, mn] = String(e.heure).split(":").map(Number);
            if (e.jour !== m.jour || h * 60 + mn !== m.minute) continue;
            const cle = `${m.date}|${e.heure}|${e.titre}|${avance}`;
            if (deja.has(cle)) continue;
            deja.add(cle);
            notifier("PokéFaction · " + prefixe + e.titre, (avance ? "" : "Ça commence ! ") + (e.texte || ""));
        }
    }
    if (deja.size > 500) deja = new Set([...deja].slice(-100));
}

function majMenu() {
    if (!icone) return;
    icone.setContextMenu(Menu.buildFromTemplate([
        { label: "Ouvrir PokéFaction", click: () => montrerFenetre() },
        { type: "separator" },
        { label: "Me prévenir des événements", type: "checkbox", checked: actif(), click: item => { const r = lireReglage(); r.actif = item.checked; ecrireReglage(r); } },
        { type: "separator" },
        { label: "Quitter", click: () => quitter() },
    ]));
}

/** Démarre la surveillance (planning relu toutes les 30 min, vérifié toutes les 20 s). */
function demarrer(url, ouvrir, fin) {
    montrerFenetre = ouvrir;
    quitter = fin;
    charger(url);
    setInterval(() => charger(url), 30 * 60 * 1000);
    setInterval(verifier, 20 * 1000);
}

/** Le joueur ferme le launcher : s'il veut les notifications, on reste près de l'horloge (true), sinon on quitte (false). */
function enArrierePlan() {
    if (!actif()) return false;
    try {
        if (!icone) {
            icone = new Tray(nativeImage.createFromPath(cheminIcone()));
            icone.setToolTip("PokéFaction : je te préviens des événements");
            icone.on("click", () => montrerFenetre());
        }
        majMenu();
    } catch { return false; }
    const r = lireReglage();
    if (!r.explique) {
        r.explique = true;
        ecrireReglage(r);
        notifier("PokéFaction reste près de l'horloge", "Je te préviens quand un événement commence. Clic droit sur l'icône PokéFaction pour couper ou quitter.");
    }
    return true;
}

function cacherIcone() {
    if (icone) { try { icone.destroy(); } catch { } icone = null; }
}

module.exports = { demarrer, enArrierePlan, cacherIcone, actif };
