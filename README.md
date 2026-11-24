# Portscope

Portscope montre les ports ouverts sur un PC Windows.
Il montre aussi ce que chaque processus consomme (CPU et mémoire).
Il tourne en local, sur `127.0.0.1`. Il n'envoie aucune donnée à l'extérieur.

![Icône Portscope](app/icon.png)

## Fonctions

- Une ligne par processus, avec ses ports TCP et UDP.
- Une courbe CPU par processus, sur les 5 dernières minutes.
- Une jauge mémoire par processus. La mémoire inclut les processus enfants.
- Un classement des processus qui consomment le plus.
- Un radar : l'anneau extérieur montre les processus exposés au réseau.
- Un arrêt de processus, avec une confirmation.
- Des lancements enregistrés (nom, commande, dossier, port).
- Un thème clair et un thème sombre.

## Prérequis

- Windows 10 ou 11.
- Node.js 20 ou plus récent.
- pnpm.
- Microsoft Edge, pour la fenêtre dédiée du raccourci.

## Installation

1. Clone le dépôt.
2. Ouvre PowerShell dans le dossier du dépôt.
3. Installe les dépendances :

   ```powershell
   pnpm install
   ```

4. Crée le raccourci du menu Démarrer :

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\install-shortcut.ps1
   ```

## Utilisation

1. Ouvre le menu Démarrer.
2. Tape « Portscope ».
3. Clique sur le raccourci.

Le raccourci fait ces opérations :

- Si la fenêtre Portscope est ouverte, il l'affiche au premier plan.
- Si le code a changé depuis le dernier build, il reconstruit l'application.
- Il démarre le serveur sur le port 4310.
- Il ouvre une fenêtre dédiée.
- Quand tu fermes la fenêtre, il arrête le serveur.

Si un autre programme utilise le port 4310, le raccourci affiche un message. Il n'arrête pas ce programme.

## Développement

```powershell
pnpm dev
```

Ouvre ensuite [http://127.0.0.1:4310](http://127.0.0.1:4310).

Avant un commit, fais ces vérifications :

```powershell
pnpm typecheck
pnpm lint
pnpm build
```

Pour modifier l'icône, modifie `scripts/make-icon.ps1`, puis exécute ce script.

## Mesures

- Le CPU est la part de toute la machine. Portscope le calcule entre deux relevés (toutes les 5 s).
- La mémoire est le « working set » du processus et de ses enfants.
- Pour un processus Windows protégé, Portscope mesure ce processus seul.
- Une connexion à zéro ne prouve pas qu'un processus est inutile. Cette valeur ne s'applique pas à UDP.

## Lancements enregistrés

Le bouton **Ajouter** enregistre un nom, une commande, un dossier et un port.
Portscope ne lance jamais ces commandes automatiquement.
La configuration est dans `data/services.json`. Les logs sont dans `data/logs/`.
Git ignore le dossier `data/`.

## Tunnel des agents (optionnel)

Le panneau « Tunnel des agents » lit l'état du script de sandbox dans
`~/.agents/worktree-sandbox/`. Si ce dossier n'existe pas, le panneau reste vide.

## Sécurité

- Le serveur écoute seulement sur `127.0.0.1`.
- Portscope refuse les requêtes qui viennent d'une autre origine.
- Portscope masque les tokens, les secrets et les mots de passe dans les lignes de commande.
- Avant un arrêt, Portscope vérifie de nouveau le PID et le nom du processus.
- Portscope n'arrête pas les processus Windows critiques, ni lui-même.
- Certains processus demandent des droits administrateur. Dans ce cas, Windows refuse l'arrêt et Portscope affiche l'erreur.

## Licence

MIT. Voir [LICENSE](LICENSE).
