// =====================================================================
// FroidPass — base de dépannage (codes erreur + diagnostic par symptôme)
// Les significations proviennent des sources citées pour chaque marque.
// Les codes varient selon la série et le modèle : toujours confirmer avec
// le manuel de service de l'appareil avant de remplacer une pièce.
// =====================================================================

// Familles de défauts : causes probables (par ordre de fréquence), vérifications, action
window.FAMILLES = {
  communication: {
    nom: "Communication unité intérieure / extérieure",
    causes: ["Câble de liaison mal serré, inversé, coupé ou épissé", "Câble de liaison trop long ou non conforme (section, blindage)", "Alimentation de l'unité extérieure absente (disjoncteur, sectionneur)", "Parasites : câble de liaison posé contre des câbles de puissance", "Carte électronique intérieure ou extérieure défectueuse"],
    verifs: ["Consigner l'installation (NF C 18-510) avant toute intervention sur les borniers", "Vérifier le serrage et l'ordre des fils sur les borniers des deux unités (N, 1, 2, 3 ou S selon le modèle)", "Mesurer la tension d'alimentation de l'unité extérieure", "Contrôler la continuité de chaque conducteur du câble de liaison ; éliminer les épissures", "Mesurer le signal de communication entre N et S (tension variable attendue en fonctionnement, valeur selon manuel)", "Si tout est conforme : tester avec un câble provisoire, puis isoler la carte en cause"],
    racine: "Dans la majorité des cas, la cause est le câblage (serrage, ordre, épissure) et non la carte : ne pas remplacer une carte avant d'avoir validé la liaison.",
    niveau: "Technicien"
  },
  capteur: {
    nom: "Sonde de température (thermistance)",
    causes: ["Connecteur de sonde oxydé ou débranché (humidité, air salé)", "Sonde coupée ou en court-circuit", "Sonde mal positionnée sur la tuyauterie", "Entrée de la carte électronique défectueuse"],
    verifs: ["Débrancher la sonde, mesurer sa résistance et la comparer à la table résistance/température du manuel (souvent 5, 10, 15 ou 20 kΩ à 25 °C selon le fabricant)", "Contrôler l'état du connecteur et du faisceau (oxydation fréquente en bord de mer)", "Vérifier la fixation et l'isolation de la sonde sur le tube", "Si la sonde est conforme : contrôler la tension de référence sur la carte"],
    racine: "Une sonde hors tolérance fausse la régulation : vérifier aussi si l'humidité ou les condensats ont atteint le connecteur.",
    niveau: "Technicien"
  },
  haute_pression: {
    nom: "Protection haute pression / surchauffe condenseur",
    causes: ["Condenseur encrassé (poussière, sel, feuilles)", "Ventilateur extérieur à l'arrêt ou trop lent (condensateur, moteur)", "Recyclage d'air chaud : unité extérieure encastrée ou mal dégagée", "Surcharge en fluide frigorigène", "Incondensables dans le circuit (tirage au vide insuffisant)", "Pressostat HP défectueux"],
    verifs: ["Vérifier le dégagement et l'exposition au soleil de l'unité extérieure", "Nettoyer le condenseur (eau basse pression, produit adapté)", "Contrôler la rotation du ventilateur extérieur et le condensateur du moteur", "Mesurer HP et BP au manomètre, comparer aux valeurs attendues pour la température extérieure", "Calculer le sous-refroidissement : élevé = surcharge probable"],
    racine: "Près de la mer (air salé), l'encrassement et la corrosion des ailettes du condenseur sont la première cause : rapprocher les nettoyages.",
    niveau: "Technicien (manipulation de fluide : attestation de capacité requise)"
  },
  basse_pression: {
    nom: "Basse pression / manque de fluide frigorigène",
    causes: ["Fuite de fluide (raccords flare, soudures, évaporateur, vannes)", "Filtres ou évaporateur encrassés (débit d'air insuffisant)", "Ventilateur intérieur trop lent", "Obstruction du circuit (déshydrateur, détendeur, capillaire)", "Charge insuffisante à la mise en service"],
    verifs: ["Nettoyer filtres et évaporateur, contrôler le débit d'air intérieur", "Mesurer HP/BP et calculer la surchauffe : élevée = manque de fluide ou restriction", "Rechercher la fuite (détecteur électronique, eau savonneuse, traces d'huile aux raccords)", "Réparer la fuite AVANT toute recharge, tirer au vide puis charger à la balance selon la plaque signalétique"],
    racine: "Une recharge sans réparation de la fuite n'est pas une solution : la panne reviendra et le compresseur s'use.",
    niveau: "Technicien (attestation de capacité fluides)"
  },
  surintensite: {
    nom: "Surintensité / protection compresseur / module IPM",
    causes: ["Tension d'alimentation instable, trop basse ou trop haute", "Condenseur encrassé ou haute pression élevée", "Compresseur grippé, bobinage défectueux", "Module IPM ou carte inverter défectueux", "Mauvais serrage des bornes de puissance"],
    verifs: ["Mesurer la tension au démarrage et en fonctionnement (chutes de tension, coupures)", "Mesurer l'intensité absorbée et la comparer à la plaque signalétique", "Vérifier le serrage des bornes et l'état des contacts", "Contrôler les enroulements du compresseur (résistances équilibrées entre U, V, W ; isolement par rapport à la masse)", "Contrôler la haute pression (voir famille Haute pression)"],
    racine: "Sur réseau instable, protéger l'appareil (protection contre les surtensions, régulateur adapté) évite des pannes répétées de cartes.",
    niveau: "Technicien qualifié électricité"
  },
  tension: {
    nom: "Tension d'alimentation anormale",
    causes: ["Tension réseau trop basse ou trop haute", "Coupures ou micro-coupures (groupe électrogène, réseau)", "Section de câble insuffisante, mauvais serrage", "Défaut du circuit de mesure de tension de la carte"],
    verifs: ["Mesurer la tension à vide et en charge au bornier de l'unité", "Vérifier la section et la longueur du câble d'alimentation", "Contrôler le serrage du disjoncteur et des bornes", "Enregistrer la tension sur plusieurs heures si le défaut est intermittent"],
    racine: "Un défaut de tension est souvent extérieur à l'appareil : traiter l'installation électrique.",
    niveau: "Électricien / technicien"
  },
  ventilateur: {
    nom: "Moteur de ventilateur",
    causes: ["Turbine bloquée ou encrassée", "Condensateur de démarrage défectueux (moteur AC)", "Moteur DC défectueux ou retour de vitesse absent", "Connecteur oxydé", "Carte de commande défectueuse"],
    verifs: ["Hors tension : tourner la turbine à la main (point dur, roulement)", "Nettoyer la turbine", "Mesurer le condensateur (capacimètre) pour un moteur AC", "Contrôler l'alimentation et le signal de retour de vitesse pour un moteur DC", "Vérifier le connecteur sur la carte"],
    racine: "Une turbine encrassée augmente la charge du moteur : l'entretien régulier évite la panne.",
    niveau: "Technicien"
  },
  condensats: {
    nom: "Évacuation des condensats / niveau d'eau",
    causes: ["Bac ou tuyau d'évacuation bouché (boue, algues)", "Pompe de relevage défectueuse", "Flotteur bloqué", "Pente d'évacuation insuffisante"],
    verifs: ["Nettoyer le bac et souffler l'évacuation", "Tester la pompe de relevage (versement d'eau dans le bac)", "Vérifier le flotteur et son contact", "Contrôler la pente et l'absence de contre-pente"],
    racine: "En climat humide, le volume de condensats est important : traiter le bac (pastilles ou nettoyage) à chaque visite.",
    niveau: "Technicien"
  },
  antigel: {
    nom: "Protection antigel de l'évaporateur",
    causes: ["Filtres encrassés", "Évaporateur encrassé", "Ventilateur intérieur trop lent", "Manque de fluide", "Consigne trop basse en continu"],
    verifs: ["Nettoyer filtres et évaporateur", "Contrôler la vitesse du ventilateur intérieur", "Mesurer la basse pression et la surchauffe", "Contrôler la sonde de tuyauterie intérieure"],
    racine: "Le gel de l'évaporateur est presque toujours un problème de débit d'air ou de charge.",
    niveau: "Technicien"
  },
  refoulement: {
    nom: "Température de refoulement compresseur élevée",
    causes: ["Manque de fluide (surchauffe élevée)", "Haute pression élevée (condenseur encrassé)", "Détendeur électronique (EEV) bloqué", "Sonde de refoulement défectueuse"],
    verifs: ["Mesurer HP, BP, surchauffe et sous-refroidissement", "Contrôler la sonde de refoulement (résistance)", "Vérifier le fonctionnement du détendeur électronique", "Rechercher une fuite si la surchauffe est élevée"],
    racine: "Un refoulement trop chaud dégrade l'huile et le compresseur : traiter rapidement la cause.",
    niveau: "Technicien (attestation de capacité fluides)"
  },
  carte: {
    nom: "Carte électronique / mémoire EEPROM",
    causes: ["Perturbation électrique ou surtension", "Humidité ou oxydation sur la carte", "Composant défectueux"],
    verifs: ["Couper l'alimentation 5 minutes puis remettre sous tension", "Inspecter la carte (traces d'humidité, d'insectes, de brûlure)", "Contrôler les tensions d'alimentation de la carte", "Remplacer la carte si le défaut persiste, en reportant cavaliers et réglages"],
    racine: "Protéger la carte de l'humidité et des surtensions ; reporter les cavaliers lors d'un remplacement.",
    niveau: "Technicien"
  },
  mode: {
    nom: "Conflit de mode (multi-split)",
    causes: ["Unités intérieures réglées sur des modes incompatibles (froid / chaud)"],
    verifs: ["Mettre toutes les unités intérieures dans le même mode"],
    racine: "Informer l'utilisateur sur le fonctionnement du multi-split.",
    niveau: "Utilisateur"
  },
  information: {
    nom: "Code d'état (pas une panne)",
    causes: ["Fonctionnement normal temporaire (dégivrage, protection, coupure de courant)"],
    verifs: ["Attendre la fin de la séquence", "Si le code revient souvent, rechercher la cause (tension, encrassement)"],
    racine: "Expliquer le code au client évite des déplacements inutiles.",
    niveau: "Utilisateur"
  },
  fuite: {
    nom: "Détection de fuite de fluide",
    causes: ["Fuite sur raccords, soudures ou échangeurs", "Capteur de détection défectueux"],
    verifs: ["Arrêter l'appareil et aérer le local", "Rechercher la fuite avec un détecteur électronique", "Réparer, tirer au vide, recharger à la balance", "Contrôler le capteur si aucune fuite n'est trouvée"],
    racine: "Avec les fluides inflammables (R32, R290), appliquer strictement les règles de sécurité du fabricant.",
    niveau: "Technicien (attestation de capacité fluides)"
  }
};

// Codes par marque. f = famille, s = source
window.MARQUES = {
  Gree: {
    src: [{ t: "Gree Comfort — codes erreur", u: "https://www.greecomfort.com/news-and-events/understanding-gree-mini-split-error-codes/" }, { t: "Gree Comfort — guide E6 (PDF)", u: "https://www.greecomfort.com/assets/documents/resource-materials/tech-tips/e6-error-code-troubleshooting-guide.pdf" }],
    codes: {
      E1: ["Protection haute pression", "haute_pression"], E2: ["Protection antigel de l'évaporateur", "antigel"], E3: ["Protection basse pression / manque de fluide", "basse_pression"],
      E4: ["Protection température de refoulement du compresseur", "refoulement"], E5: ["Protection surintensité (tension d'alimentation instable)", "surintensite"],
      E6: ["Défaut de communication unité intérieure / extérieure", "communication"], E7: ["Conflit de mode entre unités", "mode"], E8: ["Protection haute température", "haute_pression"],
      EE: ["Défaut mémoire EEPROM", "carte"], F1: ["Sonde d'ambiance intérieure", "capteur"], F2: ["Sonde d'évaporateur", "capteur"], F3: ["Sonde d'ambiance extérieure", "capteur"],
      F4: ["Sonde de tube extérieure (condenseur)", "capteur"], F5: ["Sonde de refoulement", "capteur"], H1: ["Dégivrage en cours (code d'état)", "information"],
      H5: ["Protection module IPM", "surintensite"], H6: ["Moteur de ventilateur intérieur", "ventilateur"], U3: ["Chute de tension du bus continu", "tension"], L9: ["Protection de puissance", "tension"]
    }
  },
  LG: {
    src: [{ t: "LG — codes erreur split / multi-split", u: "https://www.lg.com/ca_en/support/product-support/troubleshoot/help-library/cs-CT30000386-20153289364119/" }],
    note: "Sur certaines séries, CH01 et CH02 sont inversés (sonde d'air / sonde de tuyauterie) : vérifier le manuel du modèle.",
    codes: {
      CH01: ["Sonde intérieure (air ou tuyauterie selon la série)", "capteur"], CH02: ["Sonde intérieure (tuyauterie ou air selon la série)", "capteur"],
      CH05: ["Défaut de communication unité intérieure / extérieure", "communication"], CH07: ["Surintensité compresseur", "surintensite"],
      CH21: ["Surintensité inverter / compresseur (IPM)", "surintensite"], CH32: ["Température de refoulement trop élevée", "refoulement"],
      CH34: ["Haute pression", "haute_pression"], CH61: ["Surchauffe condenseur (échangeur extérieur encrassé ou obstrué)", "haute_pression"]
    }
  },
  Samsung: {
    src: [{ t: "Samsung — codes erreur climatiseurs (officiel)", u: "https://www.samsung.com/tr/support/home-appliances/what-are-samsung-air-conditioner-error-codes-and-solutions" }],
    codes: {
      E101: ["Pas de communication intérieur / extérieur pendant 1 minute", "communication"], E102: ["Pas de communication intérieur / extérieur", "communication"],
      E121: ["Sonde d'ambiance de l'unité intérieure", "capteur"], E122: ["Sonde de tuyauterie de l'unité intérieure", "capteur"],
      E154: ["Vitesse du ventilateur intérieur anormale", "ventilateur"], E162: ["Erreur EEPROM", "carte"], E202: ["Pas de communication intérieur / extérieur", "communication"],
      E203: ["Communication carte extérieure / inverter", "communication"], E221: ["Sonde d'ambiance extérieure", "capteur"], E237: ["Sonde d'ambiance extérieure", "capteur"],
      E251: ["Sonde de refoulement", "capteur"], E416: ["Surchauffe du gaz de refoulement", "refoulement"], E458: ["Ventilateur extérieur", "ventilateur"],
      E461: ["Défaut de démarrage du compresseur", "surintensite"], E462: ["Surintensité PFC / limitation de courant", "surintensite"], E464: ["Surintensité module IPM", "surintensite"],
      E465: ["Limite de tension compresseur", "surintensite"], E467: ["Défaut de rotation du compresseur", "surintensite"], E468: ["Capteur de courant", "carte"],
      E469: ["Capteur de tension du bus continu", "tension"], E472: ["Signal de tension alternative", "tension"], E554: ["Fuite de gaz détectée", "fuite"]
    }
  },
  Daikin: {
    src: [{ t: "Daikin — manuel de service (index des codes)", u: "https://www.manualslib.com/products/Daikin-R56nuy1-6916060.html" }, { t: "Daikin — bibliothèque de documents", u: "https://www.daikin-ce.com/content/dam/document-library/operation-manuals/as/fan-coil-units/fwt-htv/BRC51D67_Operation%20manual_3P784397-1.pdf" }],
    note: "La signification de E5 varie selon la gamme (blocage compresseur ou température de refoulement) : vérifier le manuel.",
    codes: {
      A1: ["Carte électronique intérieure", "carte"], A3: ["Niveau des condensats (pompe / flotteur)", "condensats"], A5: ["Antigel (froid) ou haute pression (chaud) de l'échangeur intérieur", "antigel"],
      A6: ["Moteur de ventilateur intérieur bloqué / surcharge", "ventilateur"], C4: ["Sonde de l'échangeur intérieur", "capteur"], C9: ["Sonde d'air aspiré", "capteur"],
      E1: ["Carte électronique extérieure", "carte"], E5: ["Blocage compresseur ou température de refoulement selon la gamme", "surintensite"], E6: ["Surintensité compresseur", "surintensite"],
      E7: ["Moteur de ventilateur extérieur", "ventilateur"], E8: ["Surintensité en entrée inverter", "surintensite"], EA: ["Vanne 4 voies", "carte"],
      F3: ["Température de refoulement anormale", "refoulement"], H6: ["Capteur de position du moteur compresseur", "surintensite"], U0: ["Manque de fluide frigorigène", "basse_pression"], U4: ["Défaut de communication intérieur / extérieur", "communication"]
    }
  },
  Midea: {
    src: [{ t: "Liste des codes Midea (manuels de service)", u: "https://arlingtonairconditioningheating.com/midea-air-conditioner-error-codes/" }],
    note: "Midea fabrique pour d'autres marques : les mêmes codes se retrouvent souvent sur ces appareils.",
    codes: {
      E0: ["Erreur EEPROM intérieure", "carte"], E1: ["Défaut de communication intérieur / extérieur", "communication"], E3: ["Vitesse du ventilateur intérieur anormale", "ventilateur"],
      E4: ["Sonde d'ambiance intérieure", "capteur"], E5: ["Sonde d'évaporateur", "capteur"], EC: ["Détection de fuite de fluide", "fuite"], EE: ["Alarme de niveau d'eau", "condensats"],
      F0: ["Protection surintensité", "surintensite"], F1: ["Sonde d'ambiance extérieure", "capteur"], F2: ["Sonde de condenseur", "capteur"], F3: ["Sonde de refoulement", "capteur"],
      F4: ["Erreur EEPROM extérieure", "carte"], F5: ["Vitesse du ventilateur extérieur (moteur DC)", "ventilateur"], P0: ["Protection module IPM", "surintensite"],
      P1: ["Protection tension haute ou basse", "tension"], P2: ["Surchauffe du haut du compresseur", "refoulement"], P3: ["Température extérieure basse", "information"],
      P4: ["Défaut de pilotage du compresseur", "surintensite"], P5: ["Conflit de mode", "mode"]
    }
  }
};

// Diagnostic par symptôme (méthode générale, à adapter à l'appareil)
window.SYMPTOMES = [
  { t: "Ne refroidit pas ou refroidit mal", e: ["split", "multi-split", "gainable", "cassette", "CTA"],
    m: ["Températures de soufflage et de reprise (écart habituel en froid : environ 8 à 12 °C sur un split)", "HP, BP, surchauffe, sous-refroidissement", "Intensité absorbée du compresseur"],
    c: ["Filtres / évaporateur encrassés", "Condenseur encrassé ou mal ventilé", "Manque de fluide (fuite)", "Compresseur qui ne démarre pas (condensateur, carte, tension)", "Dimensionnement insuffisant pour le local"] },
  { t: "Fuite d'eau à l'unité intérieure", e: ["split", "cassette", "gainable"],
    m: ["Écoulement libre du bac et du tuyau", "Pente de l'évacuation", "Fonctionnement de la pompe de relevage"],
    c: ["Évacuation bouchée", "Pompe de relevage défectueuse", "Contre-pente", "Givre qui fond (manque de fluide, filtres sales)", "Isolation des tuyauteries absente (condensation)"] },
  { t: "Givre sur l'unité intérieure ou les tuyauteries", e: ["split", "chambre froide"],
    m: ["Débit d'air", "BP et surchauffe", "Sonde de tuyauterie"],
    c: ["Filtres / évaporateur sales", "Ventilateur trop lent", "Manque de fluide", "Dégivrage défaillant (chambre froide : résistance, horloge, sonde de fin de dégivrage)"] },
  { t: "Le disjoncteur déclenche", e: ["tous"],
    m: ["Isolement du compresseur et des moteurs par rapport à la masse", "Intensité au démarrage", "Calibre et courbe du disjoncteur"],
    c: ["Défaut d'isolement compresseur ou moteur", "Court-circuit dans le câblage (humidité, rongeurs)", "Disjoncteur sous-dimensionné ou fatigué", "Compresseur grippé (intensité de démarrage élevée)"] },
  { t: "L'unité extérieure ne démarre pas", e: ["split", "multi-split", "VRV"],
    m: ["Tension à l'unité extérieure", "Signal de communication", "Condensateur du compresseur et du ventilateur"],
    c: ["Pas d'alimentation (disjoncteur, sectionneur)", "Défaut de communication", "Condensateur défectueux", "Protection thermique du compresseur active (laisser refroidir)", "Carte extérieure"] },
  { t: "Bruit ou vibrations anormaux", e: ["tous"],
    m: ["Fixations et supports antivibratiles", "Roulements des moteurs", "Tuyauteries en contact"],
    c: ["Fixations desserrées", "Turbine ou hélice déséquilibrée / encrassée", "Roulement usé", "Tuyauterie qui touche la carrosserie", "Compresseur : coup de liquide (excès de fluide)"] },
  { t: "Mauvaise odeur au soufflage", e: ["split", "cassette", "gainable", "CTA"],
    m: ["État des filtres, de l'évaporateur et du bac"],
    c: ["Moisissures sur l'évaporateur ou la turbine", "Bac à condensats stagnant", "Filtres saturés"] },
  { t: "Chambre froide : n'atteint pas sa température", e: ["chambre froide", "réfrigérateur médical"],
    m: ["Température d'évaporation et de condensation", "État des joints de porte", "Givrage de l'évaporateur"],
    c: ["Joints de porte usés, porte mal fermée", "Évaporateur pris en glace (dégivrage)", "Condenseur encrassé", "Manque de fluide", "Surcharge en marchandises chaudes"] },
  { t: "CTA : débit d'air faible / alarme filtre", e: ["CTA"],
    m: ["Perte de charge des filtres (pressostat différentiel)", "Tension et état des courroies", "Sens de rotation du ventilateur"],
    c: ["Filtres colmatés", "Courroie détendue ou cassée", "Batterie encrassée", "Registre fermé", "Variateur mal réglé"] },
  { t: "Groupe d'eau glacée : défaut HP ou BP", e: ["groupe d'eau glacée"],
    m: ["Températures de départ et de retour d'eau", "Débit d'eau (contrôleur de débit)", "HP / BP"],
    c: ["Débit d'eau insuffisant (pompe, filtre à tamis encrassé, vanne)", "Condenseur à air encrassé", "Manque ou excès de fluide", "Échangeur à plaques encrassé"] }
];

window.MANUELS = [
  { m: "Gree", u: "https://www.greecomfort.com/faqs", t: "Gree Comfort — aide et documents" },
  { m: "LG", u: "https://www.lg.com/ca_en/support/product-support/troubleshoot/help-library/cs-CT30000386-20153289364119/", t: "LG — bibliothèque d'aide" },
  { m: "Samsung", u: "https://www.samsung.com/ae/support/home-appliances/error-codes-on-samsung-indoor-air-conditioner/", t: "Samsung — support climatisation" },
  { m: "Daikin", u: "https://www.daikin-ce.com/content/dam/document-library/operation-manuals/as/fan-coil-units/fwt-htv/BRC51D67_Operation%20manual_3P784397-1.pdf", t: "Daikin — bibliothèque de documents" },
  { m: "Toutes marques", u: "https://www.manualslib.com/", t: "ManualsLib — recherche de manuels de service par modèle" }
];
