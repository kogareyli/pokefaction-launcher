; Desinstallation du launcher PokeFaction : supprime aussi le jeu (mods, Java, Minecraft),
; les comptes enregistres et le cache de mise a jour, pour qu'une reinstallation reparte de zero
; (utile quand un antivirus a abime des fichiers pendant le telechargement).
; Rien n'est supprime pendant une mise a jour automatique du launcher : a ce moment-la,
; l'ancienne version est aussi "desinstallee", mais il faut garder le jeu.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$APPDATA\.PokeFaction"
    RMDir /r "$APPDATA\pokefaction-launcher"
    RMDir /r "$LOCALAPPDATA\pokefaction-launcher-updater"
  ${endIf}
!macroend
