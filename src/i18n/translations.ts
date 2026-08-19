export type Language = "de" | "en";

/**
 * Flat key -> {de, en} map. Deliberately NOT a full app-wide translation of every string yet —
 * covers the navigation, Settings, and Home screen (the surfaces every user sees regardless of
 * what else they do) as a real, working end-to-end slice. Extending coverage to the rest of the
 * app (Game/Statistics/Tournament/Training/Players/Admin, several thousand lines of JSX between
 * them) is a large, separate mechanical sweep — see the memory note for why that wasn't attempted
 * in the same pass as building the switch itself.
 */
const translations: Record<string, Record<Language, string>> = {
  // Layout.tsx — nav
  "nav.home": { de: "Home", en: "Home" },
  "nav.game": { de: "Spiel", en: "Game" },
  "nav.stats": { de: "Stats", en: "Stats" },
  "nav.training": { de: "Training", en: "Training" },
  "nav.tournament": { de: "Turnier", en: "Tournament" },
  "nav.club": { de: "Verein", en: "Club" },
  "nav.admin": { de: "Admin", en: "Admin" },

  // Layout.tsx — header controls
  "header.lightTheme": { de: "Helles Design", en: "Light theme" },
  "header.darkTheme": { de: "Dunkles Design", en: "Dark theme" },
  "header.switchTheme": { de: "Design wechseln", en: "Switch theme" },
  "header.notificationsOn": { de: "Benachrichtigungen deaktivieren", en: "Disable notifications" },
  "header.notificationsOff": { de: "Benachrichtigungen aktivieren (z. B. Turnier-Erinnerung)", en: "Enable notifications (e.g. tournament reminders)" },
  "header.notifications": { de: "Benachrichtigungen", en: "Notifications" },
  "header.offline": { de: "offline", en: "offline" },
  "header.settings": { de: "Einstellungen", en: "Settings" },
  "header.signOut": { de: "Abmelden", en: "Sign out" },

  // Settings.tsx
  "settings.title": { de: "Einstellungen", en: "Settings" },
  "settings.language": { de: "Sprache", en: "Language" },
  "settings.languageDesc": { de: "Sprache der App-Oberfläche.", en: "Language of the app interface." },
  "settings.german": { de: "Deutsch", en: "German" },
  "settings.english": { de: "Englisch", en: "English" },
  "settings.darkMode": { de: "Dunkles Design", en: "Dark mode" },
  "settings.darkModeDesc": { de: "Wechselt zwischen hellem und dunklem Erscheinungsbild.", en: "Switches between light and dark appearance." },
  "settings.notifications": { de: "Benachrichtigungen", en: "Notifications" },
  "settings.notificationsDesc": { de: "Z. B. wenn dein Turnierspiel als Nächstes dran ist.", en: "E.g. when your tournament match is coming up next." },
  "settings.impressum": { de: "Impressum", en: "Legal Notice (Impressum)" },
  "settings.impressumWarning": {
    de: "Vorlage — bitte mit den echten Vereinsangaben ausfüllen. Erst dann ist diese Seite ein rechtsgültiges Impressum nach §5 TMG.",
    en: "Template — please fill in with the club's real details. Only then is this page a legally valid Impressum under German law (§5 TMG).",
  },
  "settings.impressumHeading": { de: "Angaben gemäß § 5 TMG", en: "Information per §5 TMG (German law)" },
  "settings.impressumClubPlaceholder": { de: "[Vereinsname einfügen]", en: "[Insert club name]" },
  "settings.impressumAddressPlaceholder": { de: "[Straße, Hausnummer einfügen]", en: "[Insert street, house number]" },
  "settings.impressumCityPlaceholder": { de: "[PLZ, Ort einfügen]", en: "[Insert postal code, city]" },
  "settings.impressumRepresented": { de: "Vertreten durch:", en: "Represented by:" },
  "settings.impressumRepresentedPlaceholder": { de: "[Name des Vorstands/verantwortliche Person einfügen]", en: "[Insert board member/responsible person's name]" },
  "settings.impressumContact": { de: "Kontakt:", en: "Contact:" },
  "settings.impressumEmailPlaceholder": { de: "[E-Mail-Adresse einfügen]", en: "[Insert email address]" },
  "settings.impressumPhoneOptional": { de: "Telefon: [optional]", en: "Phone: [optional]" },
  "settings.impressumRegister": { de: "Registereintrag:", en: "Register entry:" },
  "settings.impressumRegisterPlaceholder": { de: "[Vereinsregister, Registergericht, Registernummer einfügen, falls vorhanden]", en: "[Insert register of associations, registry court, registration number, if applicable]" },

  // Index.tsx
  "home.tagline": { de: "Darts · Verein · Gemeinschaft", en: "Darts · Club · Community" },
  "home.quickAccess": { de: "Schnellzugriff", en: "Quick access" },
  "home.newGame": { de: "Neues Spiel", en: "New game" },
  "home.newGameDesc": { de: "501 · 301 · Cricket", en: "501 · 301 · Cricket" },
  "home.tournament": { de: "Turnier", en: "Tournament" },
  "home.tournamentDesc": { de: "K.O. · Round Robin", en: "Knockout · Round robin" },
  "home.season": { de: "Saison", en: "Season" },
  "home.seasonDesc": { de: "Liga-Tabelle über mehrere Turniere", en: "League table across multiple tournaments" },
  "home.statistics": { de: "Statistiken", en: "Statistics" },
  "home.statisticsDesc": { de: "Ranglisten & Vergleiche", en: "Leaderboards & comparisons" },
  "home.training": { de: "Training", en: "Training" },
  "home.trainingDesc": { de: "Drills & Coaching", en: "Drills & coaching" },
  "home.club": { de: "Verein", en: "Club" },
  "home.clubDesc": { de: "Mitglieder verwalten", en: "Manage members" },
  "home.whatsHappening": { de: "Was war los?", en: "What's been happening?" },
  "home.recentGames": { de: "Letzte Spiele", en: "Recent games" },
  "home.noGamesYet": { de: "Noch keine Spiele gespielt.", en: "No games played yet." },
  "home.startFirstGame": { de: "Starte dein erstes Spiel!", en: "Start your first game!" },
  "home.today": { de: "Heute", en: "Today" },
  "home.yesterday": { de: "Gestern", en: "Yesterday" },
};

export function translate(key: string, language: Language): string {
  return translations[key]?.[language] ?? key;
}
