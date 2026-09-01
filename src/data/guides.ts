/** Content for Settings.tsx's "Anleitungen" tab — simple, non-technical guides for club members.
 *  German only, deliberately, matching this repo's existing precedent of not translating purely
 *  admin/internal-audience content (see Admin.tsx) — unlike normal UI strings, guide prose is
 *  substantial enough that machine-quality translation would read worse than just not having it,
 *  and every current member reads German.
 *
 *  No screenshots yet — GuidesTab/Guide already support an optional `image` (path under
 *  /guides/ in public/) for whenever real ones exist, always with placeholder names, never real
 *  members; there was no way to export an actual screenshot to a file in the session this was
 *  first written in, only view one inline. */
export interface GuideSection {
  heading?: string;
  body: string[];
}

export interface Guide {
  id: string;
  title: string;
  teaser: string;
  /** Path under /guides/ (public/), or undefined if this guide has no screenshot yet. */
  image?: string;
  imageAlt?: string;
  sections: GuideSection[];
}

export const GUIDES: Guide[] = [
  {
    id: "erste-schritte",
    title: "Erste Schritte",
    teaser: "Was die App kann und wie du startest.",
    sections: [
      {
        body: [
          "Diese App ist die digitale Heimat für euren Dart-Abend: Spiele mit automatischer Zählung, Turniere mit Turnierbaum, und eine Statistik, die sich an jeden Wurf erinnert, den ihr je gemacht habt.",
        ],
      },
      {
        heading: "1. Profil anlegen",
        body: [
          "Unter „Spieler\" legst du dein eigenes Profil an (Name, optional ein Foto). Erst mit einem Profil werden deine Spiele auch dauerhaft in der Statistik gespeichert — ohne Profil kannst du trotzdem sofort lospielen, dann läuft es aber nur als Gastpartie ohne eigene Historie.",
        ],
      },
      {
        heading: "2. Ein Spiel starten",
        body: [
          "Über „Spiel\" wählst du Spielmodus (501, Cricket, …), Spieler und ob mit oder ohne Kamera gezählt werden soll. Mit Kamera erkennt die App eure Würfe automatisch vom Board — ohne Kamera tippt ihr die Punkte einfach ein.",
        ],
      },
      {
        heading: "3. Turniere",
        body: [
          "Unter „Turniere\" könnt ihr richtige Vereins-Events mit Turnierbaum organisieren, bis zu 64 Teilnehmer. Details dazu in der eigenen Anleitung weiter unten.",
        ],
      },
      {
        heading: "4. Statistik",
        body: [
          "Jedes gespielte Bein fließt automatisch in die Statistik ein — Vereinsrangliste, dein eigener Fortschritt, direkte Duelle gegen andere Mitglieder. Details dazu ebenfalls weiter unten.",
        ],
      },
    ],
  },
  {
    id: "funktionsuebersicht",
    title: "Alle Funktionen im Überblick",
    teaser: "Ein kompletter Rundgang durch jeden Bereich der App.",
    sections: [
      {
        body: [
          "Die App deckt den kompletten Dart-Abend ab — von der ersten Aufwärmpartie bis zur Vereinsmeisterschaft. Hier eine grobe Landkarte aller Bereiche, inklusive der Extras, die man leicht übersieht.",
        ],
      },
      {
        heading: "Spielen",
        body: [
          "501, 301 (und weitere X01-Varianten) sowie Cricket, wahlweise mit Kamera-Erkennung (die App zählt eure Würfe automatisch vom Board ab) oder manueller Eingabe über ein großes Zahlenfeld. Dazu: optionale Checkout-Vorschläge, ein Münzwurf-Ersatz vor dem Spiel („Bull-off\") inklusive Stechen bei Gleichstand, Undo für den letzten Wurf, automatische Wiederherstellung falls die App mal abstürzt oder geschlossen wird, und eine Sprachansage der Punkte (mehrere Stimmen wählbar, auch abschaltbar).",
        ],
      },
      {
        heading: "Turniere",
        body: [
          "K.O.-Baum oder Round-Robin, bis zu 64 Teilnehmer, mit Turnierserien über mehrere Events hinweg. Für Zuschauer gibt es eine eigene Live-Ansicht per Link oder QR-Code — ganz ohne Login, mit automatisch rotierenden Perspektiven (laufende Partien, Turnierbaum, Highlights). Der „Board-Modus\" bindet ein Gerät fest an ein bestimmtes Board, das dann selbstständig zur jeweils nächsten anstehenden Partie weiterschaltet. Dazu Anwesenheits-Check-in der Teilnehmer und eine Restzeit-Schätzung für Admins. Alle Details dazu in der eigenen Turnier-Anleitung weiter unten.",
        ],
      },
      {
        heading: "Statistiken & Auswertungen",
        body: [
          "Neben den Grundlagen (Rangliste, Schnitt, Checkout-Quote, direkte Duelle) gibt es tiefere Auswertungen: eine Aim-Bias-Karte zeigt, wohin du tendenziell danebenwirfst, ein Clutch-Faktor misst deine Leistung unter Druck, dazu Rivalitäts-Storylines zwischen häufigen Gegnern, eine paarweise Elo-Wertung, ein Season-Recap als Jahresrückblick, und eigene Statistiken sogar für Gastspieler ohne festes Profil („Walk-on\"). Aus besonderen Momenten (180er, Checkouts) schneidet die Kamera automatisch kurze Highlight-Clips mit.",
        ],
      },
      {
        heading: "Training",
        body: [
          "Ein eigener Trainingsmodus mit Kamera-Kalibrierung sowie gezielten Übungsvorschlägen, die sich direkt auf deine eigene Aim-Bias-Auswertung beziehen.",
        ],
      },
      {
        heading: "Verein & Einstellungen",
        body: [
          "Admins können Vereinsname, Logo und Farbthema anpassen — jedes Mitglied kann zusätzlich unter „Meine Farbe\" eine eigene Akzentfarbe wählen, ganz ohne Auswirkung auf andere. Die App unterstützt mehrere unabhängige Vereine: ein eigener Verein lässt sich anlegen, neue Mitglieder kommen per Einladungslink dazu. Dazu ein editierbares Impressum, ein Admin-Bereich für Nutzerverwaltung, und die App spricht mehrere Sprachen.",
        ],
      },
    ],
  },
  {
    id: "statistiken",
    title: "Statistiken verstehen",
    teaser: "Vereinsrangliste, eigene Werte, direkte Duelle.",
    sections: [
      {
        body: [
          "Oben auf der Statistik-Seite wechselst du mit „Verein\" / „Ich\" zwischen den Zahlen des ganzen Vereins und deinen eigenen — direkt darunter gruppieren fünf Reiter alles weiter.",
        ],
      },
      {
        heading: "Übersicht",
        body: [
          "Vereinsrangliste, Vereinsrekorde (meiste 180er, bester Schnitt, höchstes Finish, …) und wie viele Spiele zuletzt gelaufen sind. Auf jede Rekord-Kachel kannst du tippen, um die komplette Rangliste für genau diesen Wert zu sehen — nicht nur den einen Spitzenreiter.",
        ],
      },
      {
        heading: "Spieler",
        body: [
          "Wähle ein Vereinsmitglied (oder wechsle oben auf „Ich\" für deine eigenen Werte): Schnitt mit Verlauf, Checkout-Quote, First-9-Schnitt, 180er, Formkurve der letzten Spiele, und wer dein „Angstgegner\" bzw. Lieblingsgegner ist.",
        ],
      },
      {
        heading: "H2H (Kopf an Kopf)",
        body: [
          "Zwei Spieler auswählen, direkter Vergleich: Bilanz, Schnitt im direkten Duell, und eine Grafik, die zeigt, wer in welcher Disziplin vorne liegt.",
        ],
      },
      {
        heading: "Spiele",
        body: [
          "Der komplette Spielverlauf. Auf ein Spiel tippen klappt es auf — dort steht dann nicht nur wer gewonnen hat, sondern die volle Wurfauswertung: Schnitt, First 9, Checkout-Quote, höchstes Finish und wie oft welche Punktzahl (40+, 60+, … bis 180) getroffen wurde, pro Leg und für das ganze Spiel zusammen.",
        ],
      },
      {
        heading: "Highlights",
        body: [
          "Kurze Videoclips von besonderen Momenten (180er, Checkouts), automatisch von der Kamera aufgezeichnet.",
        ],
      },
    ],
  },
  {
    id: "spielerprofil",
    title: "Spielerprofil",
    teaser: "Profil anlegen, Foto hochladen, eigene Werte einsehen.",
    sections: [
      {
        body: [
          "Unter „Spieler\" siehst du alle Vereinsmitglieder als Kacheln — Name, Spitzname, Schnitt, Siegquote. Auf eine Kachel tippen öffnet das volle Profil mit Statistik-Charts.",
        ],
      },
      {
        heading: "Eigenes Profil anlegen",
        body: [
          "Über „+ Mitglied\" oben rechts öffnet sich das Formular: Name (Pflicht), Spitzname, ein Emoji als Platzhalter-Avatar, und optional ein eigenes Foto. Aus dem Foto kann die App auch automatisch ein Dartshirt-Portrait generieren („KI-Portrait erstellen\") — das ist rein kosmetisch und komplett optional.",
        ],
      },
      {
        heading: "Weitere Angaben (optional)",
        body: [
          "Unter „Mehr über mich\" kannst du zusätzlich Wurfhand, Dartgewicht, Lieblings-Doppel, Wohnort, Mitglied-seit-Jahr, einen Leitspruch und Geburtstag hinterlegen — alles freiwillig, taucht dann aber schön aufbereitet auf deinem Profil auf.",
        ],
      },
      {
        heading: "Eigenes Profil bearbeiten",
        body: [
          "Nur du selbst (oder ein Admin bei einem Profil ohne verknüpften Account) kannst ein Profil nachträglich bearbeiten — über den Stift auf der Karte oder im geöffneten Profil.",
        ],
      },
    ],
  },
  {
    id: "turnier-erstellen",
    title: "Turniere",
    teaser: "Vom leeren Formular bis zur Live-Ansicht für Zuschauer.",
    sections: [
      {
        body: [
          "Unter „Turniere\" → „Neues Turnier\" öffnet sich das Anlage-Formular, in drei Abschnitte gegliedert.",
        ],
      },
      {
        heading: "Turniername",
        body: [
          "Name des Turniers, optional einer laufenden Turnierserie zuordnen, und die Grundstruktur: K.O.-System (klassischer Turnierbaum) oder Round-Robin (jeder gegen jeden).",
        ],
      },
      {
        heading: "Spielmodus",
        body: [
          "Spielmodus (501/301/Cricket/extern gespielt) und First-to-Legs für das ganze Turnier. Bei K.O. zusätzlich die Turnierbaum-Größe (am besten „Automatisch\"), verfügbare Boards, ob direkt aus dem Turnierbaum heraus gespielt werden kann, der Auslosungsmodus (zufällig oder manuell), und optional ein abweichender Modus pro Runde (z. B. Finalrunde mit mehr Legs).",
        ],
      },
      {
        heading: "Teilnehmer",
        body: [
          "Vereinsmitglieder per Klick hinzufügen, per Schnell-Eingabe eintippen, aus einer eingefügten Namensliste übernehmen, oder mit Gast-Platzhaltern auffüllen. Die Teilnehmerliste unten zeigt eine Live-Vorschau des Turnierbaums, sobald genug Spieler eingetragen sind — inklusive Freilosen/Vorrunde, falls die Teilnehmerzahl keine glatte Zweierpotenz ist.",
        ],
      },
      {
        heading: "Turnier starten",
        body: [
          "Ganz unten „Turnier starten\" legt den Turnierbaum an. Danach lässt sich jederzeit direkt aus dem Baum heraus ein Spiel für die anstehende Partie starten.",
        ],
      },
      {
        heading: "Aus dem Turnierbaum heraus spielen",
        body: [
          "Nach dem Start zeigt der Turnierbaum alle anstehenden Partien. Auf eine Partie tippen startet direkt ein Spiel mit den richtigen Spielern und dem für diese Runde hinterlegten Modus — das Ergebnis trägt sich danach automatisch in den Baum ein. Bracket und Status lassen sich bei Bedarf auch manuell nachkorrigieren.",
        ],
      },
      {
        heading: "Live-Ansicht für Zuschauer",
        body: [
          "Jedes Turnier hat einen eigenen Teilen-Link (und QR-Code) für eine reine Zuschau-Ansicht — ganz ohne Login. Die Ansicht rotiert automatisch zwischen laufenden Partien, dem Turnierbaum und aktuellen Highlights, ideal für einen Bildschirm an der Wand während des Events.",
        ],
      },
      {
        heading: "Board-Modus",
        body: [
          "Ein Tablet oder Handy lässt sich fest einem bestimmten Board zuordnen. Es zeigt dann immer automatisch die als Nächstes anstehende Partie für genau dieses Board an und schaltet nach jedem Ergebnis selbstständig weiter — kein manuelles Suchen der nächsten Partie mehr nötig.",
        ],
      },
      {
        heading: "Anwesenheit & Turnierserien",
        body: [
          "Teilnehmer können sich vor Turnierbeginn per Check-in als anwesend markieren. Mehrere Turniere lassen sich außerdem zu einer Turnierserie zusammenfassen, mit einer eigenen Serienwertung über alle enthaltenen Events hinweg.",
        ],
      },
      {
        heading: "Nach dem Turnier",
        body: [
          "Admins sehen während des laufenden Turniers eine Restzeit-Schätzung fürs Voranschreiten der Runden. Nach Abschluss fasst eine Highlight- und Auswertungsseite die besten Momente und Zahlen des Turniers zusammen.",
        ],
      },
    ],
  },
];
