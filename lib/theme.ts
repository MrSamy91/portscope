/** Clé localStorage du thème choisi ; absente = suivre le système. */
export const THEME_STORAGE_KEY = "portscope-theme";

/**
 * Script exécuté avant le premier rendu (injecté dans <head> par le layout serveur) :
 * pose `data-theme` depuis le choix mémorisé, pour éviter un flash du mauvais thème.
 * Fichier sans "use client" : un module client n'exporte pas de simples chaînes au serveur.
 */
export const themeInitScript =
  "try{var t=localStorage.getItem('" +
  THEME_STORAGE_KEY +
  "');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}";
