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
    title: "Turnier erstellen",
    teaser: "Vom leeren Formular bis zum fertigen Turnierbaum.",
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
    ],
  },
];
