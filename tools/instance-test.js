// Ajoute (ou met à jour) l'instance « PokeFaction-Test » dans web/instances du vrai launcher.
//   node tools/instance-test.js [adresse:port]   (sans adresse : la case dit « pas encore ouvert »)
const fs = require('fs');
const F = require('path').resolve(__dirname, '..', 'web', 'instances');
const j = JSON.parse(fs.readFileSync(F, 'utf8'));
const pf = j.PokeFaction;
const [hote, port] = (process.argv[2] || '').split(':');
j['PokeFaction-Test'] = {
  name: 'PokeFaction-Test',
  url: 'https://raw.githubusercontent.com/kogareyli/pokefaction-launcher/main/web/files-test/manifest.json',
  loader: { ...pf.loader },
  verify: true,
  // 21/11 (Eddy : « mets tous les settings, copie le fichier total ») : réglages, options, packs et shaders remis à chaque lancement
  // (copie exacte du jeu de test) ; seules les données du joueur restent (mondes, captures, carte, ticket…)
  ignored: [...pf.ignored.filter(p => !['options.txt', 'config', 'resourcepacks', 'shaderpacks'].includes(p) && !p.startsWith('config/')),
    'config/sodium-fingerprint.json', 'config/fancymenu/user_variables.db', 'resourcepacks/COBBLEVERSE Soundtrack.zip',
    'shaderpacks/COBBLEVERSE - Shaders', 'shaderpacks/COBBLEVERSE - Shaders (High Quality)'], // pas publiables (licence), gardés s'ils sont là
  // jamais choisie toute seule au démarrage : seulement par la 2e case du rail
  whitelistActive: true,
  whitelist: [],
  status: { nameServer: 'PokéFaction Test', ip: hote || '', port: hote ? Number(port || 25565) : 0 },
  jvm_args: [...(pf.jvm_args || [])],
  game_args: hote ? ['--quickPlayMultiplayer', `${hote}:${port || 25565}`] : [],
  serveurs_pokefaction: hote ? [hote] : [],
  sous_titre: 'PokéFaction Test',
  case_visible: ['Starless_Kirito', 'xkeijiro', 'kxjiro'],
};
fs.writeFileSync(F, JSON.stringify(j, null, 4));
console.log('instance PokeFaction-Test :', hote ? `${hote}:${port || 25565}` : 'sans adresse (pas encore ouvert)');
