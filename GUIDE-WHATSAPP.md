# Envoi automatique des tâches sur WhatsApp (API WhatsApp Cloud de Meta)

Sans cette configuration, FroidPass prévient déjà les techniciens :
- **par e-mail automatiquement** (si Brevo est configuré : `BREVO_API_KEY` + `EMAIL_EXPEDITEUR`) ;
- **par WhatsApp en un clic** : le message est prérempli, le responsable appuie sur « Envoyer ».

Pour que le message WhatsApp parte **tout seul**, il faut l'API officielle de Meta.

## Ce qu'il faut savoir avant
- **Coût** : Meta facture chaque message « utilitaire » envoyé (tarif de la zone « Reste de l'Afrique » pour le Bénin, quelques FCFA par message). Vérifiez le tarif actuel sur la grille officielle de Meta avant d'activer. Il faut une carte bancaire dans le compte Meta.
- **Numéro** : il faut un numéro dédié qui n'est **pas** déjà utilisé dans l'application WhatsApp (une puce à part).
- **Test gratuit** : Meta fournit un numéro de test qui peut écrire à 5 numéros vérifiés — idéal pour essayer.

## Étapes
1. Allez sur **developers.facebook.com** → *Mes apps* → *Créer une app* → type **Entreprise** → ajoutez le produit **WhatsApp**.
2. Dans *WhatsApp → Configuration de l'API* : notez le **Phone number ID** (identifiant du numéro). Ajoutez votre numéro de test et ceux de vos techniciens comme destinataires.
3. **Créez le modèle de message** (*WhatsApp → Modèles de message → Créer*) :
   - Nom : `nouvelle_tache`
   - Catégorie : **Utilitaire**
   - Langue : **Français**
   - Corps (copiez exactement) :
     ```
     Bonjour {{1}}, {{2}} vous a assigné {{3}} nouvelle(s) tâche(s) : {{4}}. Première échéance : {{5}}. Détails et compte rendu : {{6}} Merci d'ouvrir la tâche pour confirmer.
     ```
   - Exemples demandés par Meta : `Koffi` · `Dr Ahou` · `2` · `OT-0008 Filtres bloc B (Hôtel Plaza)` · `01/11/2026` · `https://froidpasss.mahugnonmorel.workers.dev/app#tableau`
   - Attendez l'approbation (souvent quelques minutes à quelques heures).
4. **Jeton permanent** : *business.facebook.com → Paramètres → Utilisateurs système* → créez un utilisateur système (Admin), assignez-lui l'app et le compte WhatsApp, puis *Générer un jeton* avec les permissions `whatsapp_business_messaging` et `whatsapp_business_management`.
5. **Cloudflare** → Workers → `froidpasss` → *Settings → Variables and Secrets* → ajoutez **en secret** :
   - `WHATSAPP_TOKEN` = le jeton permanent
   - `WHATSAPP_PHONE_ID` = le Phone number ID
   - (facultatif) `WHATSAPP_TEMPLATE` si vous avez donné un autre nom au modèle
   - (facultatif) `WHATSAPP_API_VERSION` (par défaut `v23.0`)
6. Dans FroidPass → **Équipe** → bouton **📱 WhatsApp** : vérifiez que chaque technicien a son numéro (format `+229 01 XX XX XX XX`).
7. Testez : *Travaux → 👥 Affecter des tâches → Nouvelle tâche*. La fenêtre de confirmation indique « WhatsApp envoyé automatiquement ».

Ne collez jamais le jeton dans une conversation ou dans le code : uniquement dans les secrets Cloudflare.
