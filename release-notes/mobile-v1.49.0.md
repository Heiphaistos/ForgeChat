Mise à jour de sécurité (audit du 17 octobre 2026, docs/AUDIT-securite-2026-10-17.md).

- Appels : chiffrement de bout en bout des médias toujours activé dès que ta clé de compte est prête ; sans clé, l'appel est refusé.
- Moteur d'IA sur l'appareil : la page et ses scripts sont vérifiés (empreintes embarquées) avant tout traitement de contenu déchiffré.
- Clés des correspondants vérifiées dans le journal de transparence ; aucun fichier ni transfert en clair quand la clé est verrouillée ; aperçus de liens désactivés par défaut (réglage dans Confidentialité).
- Activation du 2FA, export de tes données et transfert de propriété demandent ton mot de passe (et ton code 2FA pour le transfert).
- Code de récupération effacé du presse-papiers après 30 secondes ; épinglage des certificats prolongé.
