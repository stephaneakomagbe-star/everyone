# Everyone

Un petit groupe, de 2 à 12 personnes. Chaque jour, avant minuit, chacun dépose une photo ou une courte vidéo. Si tout le monde l’a fait, la série continue. Si un jour passe sans tous les dépôts, elle s’arrête.

Ce n’est pas un réseau public. Les photos restent sur l’ordinateur qui fait tourner l’application.

## Lancer

Double-clique `start.bat`, ou bien :

```bash
npm install
npm start
```

Puis ouvre [http://localhost:4317](http://localhost:4317).

Le terminal affiche aussi une adresse du type `http://192.168.x.x:4317`. C’est celle à ouvrir sur un téléphone, sur le **même Wi-Fi**. Windows peut demander d’autoriser Node sur le réseau privé : accepte, sinon le téléphone ne verra pas la page.

## Le groupe

1. Une personne crée son espace (prénom + code secret) et un groupe.
2. Elle envoie le code aux autres, et l’adresse Wi-Fi s’ils sont sur leur téléphone.
3. Chacun crée son propre espace, puis entre le code. Jusqu’à 12 personnes.
4. Chacun dépose sa photo ou sa vidéo du jour. La série avance quand tout le monde l’a fait.
5. Le lendemain, on recommence. Le nombre monte.

Sur cet ordinateur, la caméra s’ouvre dans la page. Sur un téléphone, le bouton **Prendre une photo** ouvre l’appareil photo du téléphone. On peut aussi choisir une image ou une vidéo déjà dans la galerie.

La journée suit l’horloge de l’ordinateur qui fait tourner Everyone. Laisse-le allumé jusqu’à minuit si vous voulez encore déposer.

## Où sont les photos

Dans le dossier `data/`, sur cette machine. Rien n’est envoyé à un service extérieur. Pour tout effacer, arrête l’application et supprime `data/`.
