"""
Génère web/files/manifest.json : la liste de TOUS les fichiers du modpack que le launcher télécharge.

- tools/externes.json : fichiers téléchargés directement depuis CurseForge / Modrinth (mods, packs...)
- web/files/...       : fichiers hébergés dans ce dépôt GitHub (configs, datapacks, packs persos...)

Pour ajouter un mod : mets le .jar dans web/files/mods/ (ou ajoute-le dans externes.json),
puis lance :  python tools/generer_manifest.py   (ou demande à Claude de le faire).
"""
import hashlib
import json
import os
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = os.path.join(ROOT, "web", "files")

with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as f:
    base_url = json.load(f)["url"].rstrip("/") + "/files/"

with open(os.path.join(ROOT, "tools", "externes.json"), encoding="utf-8") as f:
    entries = json.load(f)

seen = {e["path"] for e in entries}
for dirpath, _, names in os.walk(FILES):
    for name in sorted(names):
        full = os.path.join(dirpath, name)
        rel = os.path.relpath(full, FILES).replace(os.sep, "/")
        if rel == "manifest.json" or rel in seen:
            continue
        with open(full, "rb") as fh:
            data = fh.read()
        entries.append({
            "path": rel,
            "size": len(data),
            "hash": hashlib.sha1(data).hexdigest(),
            "url": base_url + urllib.parse.quote(rel),
        })

entries.sort(key=lambda e: e["path"].lower())
with open(os.path.join(FILES, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(entries, f, indent=1, ensure_ascii=False)

total = sum(e["size"] for e in entries) / 1024 / 1024
print(f"{len(entries)} fichiers, {total:.0f} Mo au total")
