export type Language = "de" | "en" | "fr" | "pl" | "nl" | "tr";

export const LANGUAGES: Language[] = ["de", "en", "fr", "pl", "nl", "tr"];

export const LOCALE_BY_LANGUAGE: Record<Language, string> = {
  de: "de-DE", en: "en-US", fr: "fr-FR", pl: "pl-PL", nl: "nl-NL", tr: "tr-TR",
};

/**
 * Flat key -> per-language string map. Deliberately NOT a full app-wide translation of every
 * string yet — covers the navigation, Settings, and Home screen (the surfaces every user sees
 * regardless of what else they do) as a real, working end-to-end slice across all 6 languages.
 * Extending coverage to the rest of the app (Game/Statistics/Tournament/Training/Players/Admin,
 * several thousand lines of JSX between them) is a large, separate mechanical sweep — see the
 * memory note for why that wasn't attempted in the same pass as building the switch itself.
 */
export const translations: Record<string, Record<Language, string>> = {
  // Layout.tsx — nav
  "nav.home": { de: "Home", en: "Home", fr: "Accueil", pl: "Start", nl: "Home", tr: "Ana Sayfa" },
  "nav.game": { de: "Spiel", en: "Game", fr: "Partie", pl: "Gra", nl: "Spel", tr: "Oyun" },
  "nav.stats": { de: "Stats", en: "Stats", fr: "Stats", pl: "Statystyki", nl: "Stats", tr: "İstatistik" },
  "nav.training": { de: "Training", en: "Training", fr: "Entraînement", pl: "Trening", nl: "Training", tr: "Antrenman" },
  "nav.tournament": { de: "Turnier", en: "Tournament", fr: "Tournoi", pl: "Turniej", nl: "Toernooi", tr: "Turnuva" },
  "nav.club": { de: "Verein", en: "Club", fr: "Club", pl: "Klub", nl: "Club", tr: "Kulüp" },
  "nav.admin": { de: "Admin", en: "Admin", fr: "Admin", pl: "Admin", nl: "Admin", tr: "Yönetici" },

  // Layout.tsx — header controls
  "header.lightTheme": { de: "Helles Design", en: "Light theme", fr: "Thème clair", pl: "Jasny motyw", nl: "Licht thema", tr: "Açık tema" },
  "header.darkTheme": { de: "Dunkles Design", en: "Dark theme", fr: "Thème sombre", pl: "Ciemny motyw", nl: "Donker thema", tr: "Koyu tema" },
  "header.switchTheme": { de: "Design wechseln", en: "Switch theme", fr: "Changer de thème", pl: "Zmień motyw", nl: "Thema wisselen", tr: "Temayı değiştir" },
  "header.notificationsOn": { de: "Benachrichtigungen deaktivieren", en: "Disable notifications", fr: "Désactiver les notifications", pl: "Wyłącz powiadomienia", nl: "Meldingen uitschakelen", tr: "Bildirimleri kapat" },
  "header.notificationsOff": { de: "Benachrichtigungen aktivieren (z. B. Turnier-Erinnerung)", en: "Enable notifications (e.g. tournament reminders)", fr: "Activer les notifications (p. ex. rappel de tournoi)", pl: "Włącz powiadomienia (np. przypomnienie o turnieju)", nl: "Meldingen inschakelen (bijv. toernooiherinnering)", tr: "Bildirimleri etkinleştir (örn. turnuva hatırlatması)" },
  "header.notifications": { de: "Benachrichtigungen", en: "Notifications", fr: "Notifications", pl: "Powiadomienia", nl: "Meldingen", tr: "Bildirimler" },
  "header.offline": { de: "offline", en: "offline", fr: "hors ligne", pl: "offline", nl: "offline", tr: "çevrimdışı" },
  "header.settings": { de: "Einstellungen", en: "Settings", fr: "Paramètres", pl: "Ustawienia", nl: "Instellingen", tr: "Ayarlar" },
  "header.signOut": { de: "Abmelden", en: "Sign out", fr: "Déconnexion", pl: "Wyloguj się", nl: "Afmelden", tr: "Çıkış yap" },

  // Settings.tsx
  "settings.title": { de: "Einstellungen", en: "Settings", fr: "Paramètres", pl: "Ustawienia", nl: "Instellingen", tr: "Ayarlar" },
  "settings.language": { de: "Sprache", en: "Language", fr: "Langue", pl: "Język", nl: "Taal", tr: "Dil" },
  "settings.languageDesc": { de: "Sprache der App-Oberfläche.", en: "Language of the app interface.", fr: "Langue de l'interface de l'application.", pl: "Język interfejsu aplikacji.", nl: "Taal van de app-interface.", tr: "Uygulama arayüzünün dili." },
  "settings.german": { de: "Deutsch", en: "German", fr: "Allemand", pl: "Niemiecki", nl: "Duits", tr: "Almanca" },
  "settings.english": { de: "Englisch", en: "English", fr: "Anglais", pl: "Angielski", nl: "Engels", tr: "İngilizce" },
  "settings.french": { de: "Französisch", en: "French", fr: "Français", pl: "Francuski", nl: "Frans", tr: "Fransızca" },
  "settings.polish": { de: "Polnisch", en: "Polish", fr: "Polonais", pl: "Polski", nl: "Pools", tr: "Lehçe" },
  "settings.dutch": { de: "Niederländisch", en: "Dutch", fr: "Néerlandais", pl: "Niderlandzki", nl: "Nederlands", tr: "Felemenkçe" },
  "settings.turkish": { de: "Türkisch", en: "Turkish", fr: "Turc", pl: "Turecki", nl: "Turks", tr: "Türkçe" },
  "settings.darkMode": { de: "Dunkles Design", en: "Dark mode", fr: "Mode sombre", pl: "Tryb ciemny", nl: "Donkere modus", tr: "Koyu mod" },
  "settings.darkModeDesc": { de: "Wechselt zwischen hellem und dunklem Erscheinungsbild.", en: "Switches between light and dark appearance.", fr: "Bascule entre l'apparence claire et sombre.", pl: "Przełącza między jasnym a ciemnym wyglądem.", nl: "Wisselt tussen licht en donker uiterlijk.", tr: "Açık ve koyu görünüm arasında geçiş yapar." },
  "settings.notifications": { de: "Benachrichtigungen", en: "Notifications", fr: "Notifications", pl: "Powiadomienia", nl: "Meldingen", tr: "Bildirimler" },
  "settings.notificationsDesc": { de: "Z. B. wenn dein Turnierspiel als Nächstes dran ist.", en: "E.g. when your tournament match is coming up next.", fr: "P. ex. quand c'est bientôt à ton tour en tournoi.", pl: "Np. gdy Twój mecz turniejowy jest następny w kolejce.", nl: "Bijv. wanneer je toernooiwedstrijd zo aan de beurt is.", tr: "Örn. turnuva maçın sırada olduğunda." },
  "settings.impressum": { de: "Impressum", en: "Legal Notice (Impressum)", fr: "Mentions légales (Impressum)", pl: "Nota prawna (Impressum)", nl: "Colofon (Impressum)", tr: "Yasal Bildirim (Impressum)" },
  "settings.impressumWarning": {
    de: "Vorlage — bitte mit den echten Vereinsangaben ausfüllen. Erst dann ist diese Seite ein rechtsgültiges Impressum nach §5 TMG.",
    en: "Template — please fill in with the club's real details. Only then is this page a legally valid Impressum under German law (§5 TMG).",
    fr: "Modèle — merci de le compléter avec les vraies informations du club. Ce n'est qu'alors que cette page constitue des mentions légales valides selon le §5 TMG (droit allemand).",
    pl: "Szablon — proszę uzupełnić rzeczywistymi danymi klubu. Dopiero wtedy ta strona stanowi ważną notę prawną zgodnie z §5 TMG (prawo niemieckie).",
    nl: "Sjabloon — vul de echte verenigingsgegevens in. Pas dan is deze pagina een rechtsgeldig colofon volgens §5 TMG (Duits recht).",
    tr: "Şablon — lütfen kulübün gerçek bilgileriyle doldurun. Ancak o zaman bu sayfa §5 TMG (Alman hukuku) uyarınca geçerli bir yasal bildirim olur.",
  },
  "settings.impressumHeading": { de: "Angaben gemäß § 5 TMG", en: "Information per §5 TMG (German law)", fr: "Informations selon le § 5 TMG (droit allemand)", pl: "Informacje zgodnie z § 5 TMG (prawo niemieckie)", nl: "Gegevens conform § 5 TMG (Duits recht)", tr: "§ 5 TMG uyarınca bilgiler (Alman hukuku)" },
  "settings.impressumClubPlaceholder": { de: "[Vereinsname einfügen]", en: "[Insert club name]", fr: "[Insérer le nom du club]", pl: "[Wstaw nazwę klubu]", nl: "[Naam van de vereniging invoegen]", tr: "[Kulüp adını girin]" },
  "settings.impressumAddressPlaceholder": { de: "[Straße, Hausnummer einfügen]", en: "[Insert street, house number]", fr: "[Insérer rue, numéro]", pl: "[Wstaw ulicę, numer]", nl: "[Straat, huisnummer invoegen]", tr: "[Cadde, kapı numarasını girin]" },
  "settings.impressumCityPlaceholder": { de: "[PLZ, Ort einfügen]", en: "[Insert postal code, city]", fr: "[Insérer code postal, ville]", pl: "[Wstaw kod pocztowy, miasto]", nl: "[Postcode, plaats invoegen]", tr: "[Posta kodu, şehir girin]" },
  "settings.impressumRepresented": { de: "Vertreten durch:", en: "Represented by:", fr: "Représenté par :", pl: "Reprezentowany przez:", nl: "Vertegenwoordigd door:", tr: "Temsilcisi:" },
  "settings.impressumRepresentedPlaceholder": { de: "[Name des Vorstands/verantwortliche Person einfügen]", en: "[Insert board member/responsible person's name]", fr: "[Insérer le nom du président/de la personne responsable]", pl: "[Wstaw imię i nazwisko zarządu/osoby odpowiedzialnej]", nl: "[Naam van het bestuur/verantwoordelijke persoon invoegen]", tr: "[Yönetim kurulu/sorumlu kişinin adını girin]" },
  "settings.impressumContact": { de: "Kontakt:", en: "Contact:", fr: "Contact :", pl: "Kontakt:", nl: "Contact:", tr: "İletişim:" },
  "settings.impressumEmailPlaceholder": { de: "[E-Mail-Adresse einfügen]", en: "[Insert email address]", fr: "[Insérer l'adresse e-mail]", pl: "[Wstaw adres e-mail]", nl: "[E-mailadres invoegen]", tr: "[E-posta adresini girin]" },
  "settings.impressumPhoneOptional": { de: "Telefon: [optional]", en: "Phone: [optional]", fr: "Téléphone : [optionnel]", pl: "Telefon: [opcjonalnie]", nl: "Telefoon: [optioneel]", tr: "Telefon: [isteğe bağlı]" },
  "settings.impressumRegister": { de: "Registereintrag:", en: "Register entry:", fr: "Inscription au registre :", pl: "Wpis do rejestru:", nl: "Registerinschrijving:", tr: "Sicil kaydı:" },
  "settings.impressumRegisterPlaceholder": { de: "[Vereinsregister, Registergericht, Registernummer einfügen, falls vorhanden]", en: "[Insert register of associations, registry court, registration number, if applicable]", fr: "[Insérer le registre des associations, tribunal d'immatriculation, numéro, le cas échéant]", pl: "[Wstaw rejestr stowarzyszeń, sąd rejestrowy, numer rejestru, jeśli dotyczy]", nl: "[Verenigingsregister, registergerecht, registratienummer invoegen, indien van toepassing]", tr: "[Varsa dernekler sicili, sicil mahkemesi, sicil numarasını girin]" },

  // Index.tsx
  "home.tagline": { de: "Darts · Verein · Gemeinschaft", en: "Darts · Club · Community", fr: "Fléchettes · Club · Communauté", pl: "Darty · Klub · Wspólnota", nl: "Darts · Club · Gemeenschap", tr: "Dart · Kulüp · Topluluk" },
  "home.quickAccess": { de: "Schnellzugriff", en: "Quick access", fr: "Accès rapide", pl: "Szybki dostęp", nl: "Snelle toegang", tr: "Hızlı erişim" },
  "home.newGame": { de: "Neues Spiel", en: "New game", fr: "Nouvelle partie", pl: "Nowa gra", nl: "Nieuw spel", tr: "Yeni oyun" },
  "home.newGameDesc": { de: "501 · 301 · Cricket", en: "501 · 301 · Cricket", fr: "501 · 301 · Cricket", pl: "501 · 301 · Cricket", nl: "501 · 301 · Cricket", tr: "501 · 301 · Cricket" },
  "home.tournament": { de: "Turnier", en: "Tournament", fr: "Tournoi", pl: "Turniej", nl: "Toernooi", tr: "Turnuva" },
  "home.tournamentDesc": { de: "K.O. · Round Robin", en: "Knockout · Round robin", fr: "Élimination directe · Round robin", pl: "Pucharowy · Każdy z każdym", nl: "Knock-out · Round robin", tr: "Eleme usulü · Round robin" },
  "home.season": { de: "Saison", en: "Season", fr: "Saison", pl: "Sezon", nl: "Seizoen", tr: "Sezon" },
  "home.seasonDesc": { de: "Liga-Tabelle über mehrere Turniere", en: "League table across multiple tournaments", fr: "Classement sur plusieurs tournois", pl: "Tabela ligowa na przestrzeni wielu turniejów", nl: "Ranglijst over meerdere toernooien", tr: "Birden fazla turnuva üzerinden lig tablosu" },
  "home.statistics": { de: "Statistiken", en: "Statistics", fr: "Statistiques", pl: "Statystyki", nl: "Statistieken", tr: "İstatistikler" },
  "home.statisticsDesc": { de: "Ranglisten & Vergleiche", en: "Leaderboards & comparisons", fr: "Classements & comparaisons", pl: "Rankingi i porównania", nl: "Ranglijsten & vergelijkingen", tr: "Sıralamalar ve karşılaştırmalar" },
  "home.training": { de: "Training", en: "Training", fr: "Entraînement", pl: "Trening", nl: "Training", tr: "Antrenman" },
  "home.trainingDesc": { de: "Drills & Coaching", en: "Drills & coaching", fr: "Exercices & coaching", pl: "Ćwiczenia i coaching", nl: "Oefeningen & coaching", tr: "Antrenmanlar ve koçluk" },
  "home.club": { de: "Verein", en: "Club", fr: "Club", pl: "Klub", nl: "Club", tr: "Kulüp" },
  "home.clubDesc": { de: "Mitglieder verwalten", en: "Manage members", fr: "Gérer les membres", pl: "Zarządzaj członkami", nl: "Leden beheren", tr: "Üyeleri yönet" },
  "home.whatsHappening": { de: "Was war los?", en: "What's been happening?", fr: "Quoi de neuf ?", pl: "Co się działo?", nl: "Wat is er gebeurd?", tr: "Neler oldu?" },
  "home.recentGames": { de: "Letzte Spiele", en: "Recent games", fr: "Parties récentes", pl: "Ostatnie gry", nl: "Recente potjes", tr: "Son oyunlar" },
  "home.noGamesYet": { de: "Noch keine Spiele gespielt.", en: "No games played yet.", fr: "Aucune partie jouée pour l'instant.", pl: "Nie rozegrano jeszcze żadnej gry.", nl: "Nog geen potjes gespeeld.", tr: "Henüz oyun oynanmadı." },
  "home.startFirstGame": { de: "Starte dein erstes Spiel!", en: "Start your first game!", fr: "Lance ta première partie !", pl: "Rozegraj swoją pierwszą grę!", nl: "Start je eerste potje!", tr: "İlk oyununu başlat!" },
  "home.today": { de: "Heute", en: "Today", fr: "Aujourd'hui", pl: "Dzisiaj", nl: "Vandaag", tr: "Bugün" },
  "home.yesterday": { de: "Gestern", en: "Yesterday", fr: "Hier", pl: "Wczoraj", nl: "Gisteren", tr: "Dün" },

  // Statistics.tsx — shared chrome (scope toggle, filter bar, tab nav) + Overview tab.
  // The Players/H2H/Games/Highlights tabs are NOT covered yet — see the memory note on i18n
  // scope for why coverage is being extended page by page rather than all at once.
  "stats.title": { de: "Statistiken", en: "Statistics", fr: "Statistiques", pl: "Statystyki", nl: "Statistieken", tr: "İstatistikler" },
  "stats.myself": { de: "Ich", en: "Me", fr: "Moi", pl: "Ja", nl: "Ik", tr: "Ben" },
  "stats.noProfileLinked": { de: "Kein Spielerprofil mit deinem Account verknüpft — persönliche Statistiken brauchen diese Verknüpfung.", en: "No player profile linked to your account — personal statistics need this link.", fr: "Aucun profil joueur lié à ton compte — les statistiques personnelles ont besoin de ce lien.", pl: "Żaden profil gracza nie jest połączony z Twoim kontem — statystyki osobiste wymagają tego połączenia.", nl: "Geen spelersprofiel gekoppeld aan je account — persoonlijke statistieken hebben deze koppeling nodig.", tr: "Hesabına bağlı bir oyuncu profili yok — kişisel istatistikler için bu bağlantı gerekir." },
  "stats.goToPlayers": { de: "Zu den Spielern", en: "Go to players", fr: "Voir les joueurs", pl: "Przejdź do graczy", nl: "Naar spelers", tr: "Oyunculara git" },
  "stats.filter": { de: "Filter", en: "Filter", fr: "Filtre", pl: "Filtr", nl: "Filter", tr: "Filtre" },
  "stats.games": { de: "Spiele", en: "games", fr: "parties", pl: "gier", nl: "potjes", tr: "oyun" },
  "stats.reset": { de: "Zurücksetzen", en: "Reset", fr: "Réinitialiser", pl: "Resetuj", nl: "Resetten", tr: "Sıfırla" },
  "stats.timeframe": { de: "Zeitraum", en: "Time range", fr: "Période", pl: "Okres", nl: "Periode", tr: "Zaman aralığı" },
  "stats.allTime": { de: "Alle Zeit", en: "All time", fr: "Depuis toujours", pl: "Cały czas", nl: "Alle tijd", tr: "Tüm zamanlar" },
  "stats.last7Days": { de: "Letzte 7 Tage", en: "Last 7 days", fr: "7 derniers jours", pl: "Ostatnie 7 dni", nl: "Laatste 7 dagen", tr: "Son 7 gün" },
  "stats.last30Days": { de: "Letzte 30 Tage", en: "Last 30 days", fr: "30 derniers jours", pl: "Ostatnie 30 dni", nl: "Laatste 30 dagen", tr: "Son 30 gün" },
  "stats.last12Months": { de: "Letzte 12 Monate", en: "Last 12 months", fr: "12 derniers mois", pl: "Ostatnie 12 miesięcy", nl: "Laatste 12 maanden", tr: "Son 12 ay" },
  "stats.allSeasons": { de: "Alle Saisons", en: "All seasons", fr: "Toutes les saisons", pl: "Wszystkie sezony", nl: "Alle seizoenen", tr: "Tüm sezonlar" },
  "stats.mode": { de: "Modus", en: "Mode", fr: "Mode", pl: "Tryb", nl: "Modus", tr: "Mod" },
  "stats.allModes": { de: "Alle Modi", en: "All modes", fr: "Tous les modes", pl: "Wszystkie tryby", nl: "Alle modi", tr: "Tüm modlar" },
  "stats.player": { de: "Spieler", en: "Player", fr: "Joueur", pl: "Gracz", nl: "Speler", tr: "Oyuncu" },
  "stats.allPlayers": { de: "Alle Spieler", en: "All players", fr: "Tous les joueurs", pl: "Wszyscy gracze", nl: "Alle spelers", tr: "Tüm oyuncular" },
  "stats.bestOf": { de: "Best of", en: "Best of", fr: "Best of", pl: "Best of", nl: "Best of", tr: "Best of" },
  "stats.allFormats": { de: "Alle Formate", en: "All formats", fr: "Tous les formats", pl: "Wszystkie formaty", nl: "Alle formats", tr: "Tüm formatlar" },
  "stats.tabOverview": { de: "Übersicht", en: "Overview", fr: "Aperçu", pl: "Przegląd", nl: "Overzicht", tr: "Genel Bakış" },
  "stats.tabPlayers": { de: "Spieler", en: "Players", fr: "Joueurs", pl: "Gracze", nl: "Spelers", tr: "Oyuncular" },
  "stats.tabH2H": { de: "H2H", en: "H2H", fr: "H2H", pl: "H2H", nl: "H2H", tr: "H2H" },
  "stats.tabGames": { de: "Spiele", en: "Games", fr: "Parties", pl: "Gry", nl: "Potjes", tr: "Oyunlar" },
  "stats.tabHighlights": { de: "Highlights", en: "Highlights", fr: "Highlights", pl: "Najlepsze momenty", nl: "Highlights", tr: "Öne Çıkanlar" },
  "stats.tabMyStats": { de: "Meine Stats", en: "My stats", fr: "Mes stats", pl: "Moje statystyki", nl: "Mijn stats", tr: "İstatistiklerim" },
  "stats.tabMyGames": { de: "Meine Spiele", en: "My games", fr: "Mes parties", pl: "Moje gry", nl: "Mijn potjes", tr: "Oyunlarım" },
  "stats.tabMyHighlights": { de: "Meine Highlights", en: "My highlights", fr: "Mes highlights", pl: "Moje najlepsze momenty", nl: "Mijn highlights", tr: "Öne Çıkanlarım" },
  "stats.gamesPlayed": { de: "Gespielte Spiele", en: "Games played", fr: "Parties jouées", pl: "Rozegrane gry", nl: "Gespeelde potjes", tr: "Oynanan oyunlar" },
  "stats.members": { de: "Mitglieder", en: "Members", fr: "Membres", pl: "Członkowie", nl: "Leden", tr: "Üyeler" },
  "stats.clubAverage": { de: "Ø Club-Average", en: "Club average", fr: "Moyenne du club", pl: "Średnia klubowa", nl: "Club-gemiddelde", tr: "Kulüp ortalaması" },
  "stats.dartsThrown": { de: "Geworfene Darts", en: "Darts thrown", fr: "Fléchettes lancées", pl: "Rzucone lotki", nl: "Geworpen darts", tr: "Atılan dartlar" },
  "stats.oneEighties": { de: "180er", en: "180s", fr: "180", pl: "180-ki", nl: "180's", tr: "180'ler" },
  "stats.highestScore": { de: "Höchster Score", en: "Highest score", fr: "Meilleur score", pl: "Najwyższy wynik", nl: "Hoogste score", tr: "En yüksek skor" },
  "stats.bestAverage": { de: "Bester Ø", en: "Best average", fr: "Meilleure moyenne", pl: "Najlepsza średnia", nl: "Beste gemiddelde", tr: "En iyi ortalama" },
  "stats.bestGameAverage": { de: "Bester Game-Ø", en: "Best game average", fr: "Meilleure moyenne en partie", pl: "Najlepsza średnia w grze", nl: "Beste potje-gemiddelde", tr: "En iyi oyun ortalaması" },
  "stats.mostWins": { de: "Meiste Siege", en: "Most wins", fr: "Plus de victoires", pl: "Najwięcej zwycięstw", nl: "Meeste overwinningen", tr: "En çok galibiyet" },
  "stats.highestFinish": { de: "Höchstes Finish", en: "Highest finish", fr: "Meilleur finish", pl: "Najwyższe zakończenie", nl: "Hoogste finish", tr: "En yüksek bitiriş" },
  "stats.bestCheckoutPct": { de: "Beste Checkout %", en: "Best checkout %", fr: "Meilleur % de checkout", pl: "Najlepszy % checkoutu", nl: "Beste checkout %", tr: "En iyi checkout %" },
  "stats.bestMpr": { de: "Beste MPR (Cricket)", en: "Best MPR (Cricket)", fr: "Meilleur MPR (Cricket)", pl: "Najlepsze MPR (Cricket)", nl: "Beste MPR (Cricket)", tr: "En iyi MPR (Cricket)" },
  "stats.gamesLast30Days": { de: "Spiele der letzten 30 Tage", en: "Games in the last 30 days", fr: "Parties des 30 derniers jours", pl: "Gry z ostatnich 30 dni", nl: "Potjes van de laatste 30 dagen", tr: "Son 30 gündeki oyunlar" },
  "stats.tripleAnalysis": { de: "Triple-Analyse", en: "Triple analysis", fr: "Analyse des triples", pl: "Analiza tripli", nl: "Triple-analyse", tr: "Triple analizi" },
  "stats.treblelessVisits": { de: "Trebleless Visits", en: "Trebleless visits", fr: "Visites sans triple", pl: "Wizyty bez tripla", nl: "Trebleless beurten", tr: "Triple'sız turlar" },
  "stats.of": { de: "von", en: "of", fr: "sur", pl: "z", nl: "van", tr: "/" },
  "stats.visits": { de: "Visits", en: "visits", fr: "visites", pl: "wizyt", nl: "beurten", tr: "tur" },
  "stats.triplesTotal": { de: "Triples gesamt", en: "Triples total", fr: "Total triples", pl: "Triple łącznie", nl: "Triples totaal", tr: "Toplam triple" },
};

export function translate(key: string, language: Language): string {
  return translations[key]?.[language] ?? key;
}
