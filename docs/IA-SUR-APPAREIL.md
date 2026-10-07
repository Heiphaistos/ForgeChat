# IA sur l'appareil (2026-10-08)

Traduction d'un message, résumé des non-lus, transcription des messages vocaux et sous-titres
d'appel, **calculés sur l'appareil**. Le texte et l'audio (déjà déchiffrés, docs/CHIFFREMENT-E2E.md)
ne quittent jamais l'appareil ; aucune API d'IA tierce, aucun service payant. Seuls les modèles
(fichiers publics) sont téléchargés, depuis NOTRE serveur, à la demande de l'utilisateur (taille
affichée avant), vérifiés par SHA-256 au téléchargement et à chaque lecture.

## Fonctions et plateformes

| Fonction | Web et bureau | Android |
|---|---|---|
| Traduire (fr, en, es, de, it, pt) | bouton « Traduire » au survol d'un message | menu d'un message |
| Résumer les non-lus (extractif, sans modèle) | bandeau « Tu as raté N messages » dès 5 non-lus | même bandeau en haut de la conversation |
| Transcrire un message vocal | « Transcrire » sous le lecteur | « Transcrire » sous le lecteur |
| Sous-titres d'appel (son reçu seulement) | salons vocaux et appels MP | **non disponible** (voir Limites) |
| Réglages (fonctions, langue cible, modèles, espace) | Réglages > IA sur l'appareil | Toi > IA sur l'appareil |

## Fonctionnement

- Moteur : transformers.js 4.3.1 (Apache-2.0) recopié dans `client/src/ai/vendor/transformers.min.js`
  (il embarque onnxruntime-web, MIT), exécuté dans un Worker (`client/src/ai/engine.worker.ts`) en
  WebAssembly, un seul fil (pas d'en-têtes COOP/COEP). Le Worker n'a aucun accès réseau : `env.fetch`
  sert les fichiers depuis IndexedDB (`forgechat-ai`), et toute demande hors manifeste reçoit un 404.
- Pourquoi une copie et pas `npm install` : dépendance unique et indispensable (aucune inférence
  possible sans), `node_modules` partagés entre plusieurs chantiers ; la copie est figée par son
  empreinte et chargée seulement quand une fonction d'IA sert (morceau `engine.worker-*.js`, 557 Ko).
- Manifeste unique : `client/src/ai/models.json` (chemin, taille, SHA-256, source amont à révision
  figée). Lu par l'appli et par `deploy/ai-models-fetch.sh`.
- Traduction : Opus-MT par paire ; passage par l'anglais quand ni la source ni la cible ne l'est
  (`planTranslation`). Langue source détectée localement sans modèle (`client/src/ai/text.ts`).
- Transcription : Whisper base multilingue quantifié ; langue parlée détectée par le premier pas du
  décodeur (sinon transformers.js forcerait l'anglais et Whisper traduirait au lieu de transcrire).
- Sous-titres : son reçu déjà déchiffré (WebRTC/LiveKit) → mono 16 kHz → découpage par pauses
  (`SpeechChunker`) → transcription ; affichés localement, jamais envoyés. File de 2 morceaux au plus.
- Android : la page `<serveur>/ai-engine.html` (même code, `client/src/ai/bridge.ts`) tourne dans une
  WebView cachée (`mobile/src/features/ai/AiEngineHost.tsx`) montée à la première demande ; texte et
  audio lui sont passés en mémoire (`injectJavaScript`), la réponse revient par `postMessage`.
  Navigation limitée à cette seule page.
- Ancienne route `POST /api/messages/:id/translate` (envoyait le texte à api.mymemory.translated.net)
  **supprimée** du serveur ; les anciennes applis affichent « Traduction indisponible ».

## Modèles à déposer sur le VPS

Dossier statique servi en `/ai-models/` : `/srv/forgechat-ai-models` (hors du dossier de déploiement,
que `rsync --delete` viderait). 568 046 596 octets (542 Mio) au total.

```bash
cd /opt/forgechat   # dossier de déploiement (contient client/src/ai/models.json)
sudo deploy/ai-models-fetch.sh /srv/forgechat-ai-models
```

Le script télécharge chaque fichier depuis sa source amont à révision figée, vérifie taille et SHA-256
et refuse tout fichier non conforme ; relancé, il ne retélécharge rien. Bloc nginx à ajouter dans
`/etc/nginx/sites-enabled/forgechat` (bloc `server` 443, avant `location /api/`), puis
`nginx -t && systemctl reload nginx` :

```nginx
location ^~ /ai-models/ {
    alias /srv/forgechat-ai-models/;
    default_type application/octet-stream;
    types { application/wasm wasm; application/json json; }
    add_header Access-Control-Allow-Origin "*" always;   # appli de bureau (origine tauri.localhost)
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Content-Security-Policy "default-src 'none'; sandbox" always;
}
```

| Pack | Modèle | Taille | Licence | Source |
|---|---|---|---|---|
| runtime | onnxruntime-web 1.31.0-dev.20260914-8d85527a0, `ort-wasm-simd-threaded.asyncify.wasm` | 26,9 Mo | MIT | cdn.jsdelivr.net/npm/onnxruntime-web@… |
| whisper | Xenova/whisper-base (quantifié q8) @64da572 | 79,7 Mo | Apache-2.0 | huggingface.co/Xenova/whisper-base |
| romance-en | Xenova/opus-mt-ROMANCE-en @f60feaa (fr, es, it, pt → en) | 119,2 Mo | Apache-2.0 | huggingface.co/Xenova/opus-mt-ROMANCE-en |
| en-romance | Xenova/opus-mt-en-ROMANCE @9d2ba69 (en → fr, es, it, pt) | 119,2 Mo | Apache-2.0 | huggingface.co/Xenova/opus-mt-en-ROMANCE |
| de-en | Xenova/opus-mt-de-en @399dfd6 | 111,5 Mo | Apache-2.0 | huggingface.co/Xenova/opus-mt-de-en |
| en-de | Xenova/opus-mt-en-de @1ca130c | 111,5 Mo | CC-BY-4.0 (Helsinki-NLP, attribution) | huggingface.co/Xenova/opus-mt-en-de |

Fichiers par modèle : `config.json`, `generation_config.json`, `tokenizer.json`,
`tokenizer_config.json`, `onnx/encoder_model_quantized.onnx`, `onnx/decoder_model_merged_quantized.onnx`
(+ `preprocessor_config.json` pour Whisper). Liste exacte avec empreintes : `client/src/ai/models.json`.

## Mesures (Chromium 151 sans GPU, i7, un seul fil)

Téléchargement local des 542 Mio : 16 s. Traduction d'une phrase : 0,4 à 3 s (chargement du modèle
compris la première fois). Message vocal de 9 s : 9 s (chargement compris), 6 s ensuite.

## Tests

`client/scripts/ai.test.mjs` (détection de langue, découpage, plan de traduction, manifeste,
vérification d'empreinte, résumé, découpage audio) et `mobile/__tests__/ai.test.ts` (résumé, pont) ;
aucun ne télécharge de modèle. Essai de bout en bout fait à la main dans Chromium (page
`ai-engine.html` servie localement avec les vrais modèles) : traductions fr→en, es→fr, de→fr, en→pt,
it→de et transcriptions fr/en correctes, aucune requête hors de l'origine locale.

## Limites

- Sous-titres sur Android : le son reçu d'un appel (WebRTC natif) n'est pas accessible à l'appli
  sans module natif lourd ; la reconnaissance vocale du système ne garantit pas le traitement local
  et n'écoute que le micro. Indiqué dans les réglages.
- Résumé génératif : pas de petit modèle multilingue raisonnable en WebAssembly ; résumé extractif
  seulement.
- Traduction par l'anglais pour les paires sans anglais (qualité un peu moindre) ; détection de
  langue limitée aux six langues ; messages très courts (« ok ») non traduits.
- WebGPU non utilisé (modèles quantifiés q8, faits pour WebAssembly) ; un seul fil sans COOP/COEP.
- Mémoire : ~250 Mo par modèle chargé ; au plus deux modèles de traduction gardés en mémoire.
- Non essayé sur un vrai téléphone ni dans l'appli de bureau construite (WebView2/WebKitGTK).
