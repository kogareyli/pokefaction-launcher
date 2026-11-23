// 23/11 (Eddy : « les couleurs comme la plume de Rayquaza ou l'œil, dans le menu et partout ») : les jaunes du launcher deviennent
// les ors de la plume (même rampe que le mod : or #d8c070, bouton #b8944a, or pâle #e8d898, or sombre #785818).
//   node tools/couleurs-plume.js     (relancer ne change plus rien)
const fs = require('fs'), path = require('path');
const CARTE = [
    [/#f5b50c(?![0-9a-f])/gi, '#d8c070'], [/#f2b112(?![0-9a-f])/gi, '#b8944a'], [/#9c7208(?![0-9a-f])/gi, '#785818'],
    [/#f7d27a(?![0-9a-f])/gi, '#e8d898'], [/#d99e0a(?![0-9a-f])/gi, '#a8843a'],
    [/245,\s*181,\s*12(?!\d)/g, '216, 192, 112'], [/242,\s*177,\s*18(?!\d)/g, '184, 148, 74'],
];
let n = 0, f = 0;
(function tour(d) {
    for (const x of fs.readdirSync(d)) {
        const p = path.join(d, x);
        if (fs.statSync(p).isDirectory()) { tour(p); continue; }
        if (!/\.(css|html|js)$/.test(x)) continue;
        let t = fs.readFileSync(p, 'utf8'); const a = t;
        for (const [re, v] of CARTE) t = t.replace(re, () => { n++; return v; });
        if (t !== a) { fs.writeFileSync(p, t); f++; }
    }
})(path.join(__dirname, '..', 'src'));
console.log('launcher : ' + n + ' couleurs dans ' + f + ' fichiers');
