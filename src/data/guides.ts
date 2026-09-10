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
        heading: "3. Turniere & Liga",
        body: [
          "Unter „Turniere\" könnt ihr richtige Vereins-Events mit Turnierbaum organisieren, bis zu 64 Teilnehmer. Für eine Runde, die sich über mehrere Wochen zieht, gibt es zusätzlich „Liga\" — jeder gegen jeden, mit laufender Tabelle statt Turnierbaum. Details zu beidem in den eigenen Anleitungen weiter unten.",
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
          "501, 301 (und weitere X01-Varianten, inklusive frei wählbarem Custom-Startscore) sowie Cricket (auch mit eigenen Zielzahlen), wahlweise mit Kamera-Erkennung (die App zählt eure Würfe automatisch vom Board ab) oder manueller Eingabe über ein großes Zahlenfeld. Dazu jede Menge Optionen: Team-Modus (2v2 bis 4v4), Bot-Gegner in fünf Schwierigkeitsstufen, ein „Geist-Modus\" gegen die eigene Bestleistung, Handicap-Vorsprung, ein voller Sets-Modus (Best of Sätze, je Satz Best of Legs), ein optionales Aufwärm-Timer vor dem Match und eine cinematische Einlaufsequenz mit Stats-Vergleich und Gewinnwahrscheinlichkeit. Außerdem: optionale Checkout-Vorschläge, ein Münzwurf-Ersatz vor dem Spiel („Bull-off\") inklusive Stechen bei Gleichstand, Undo für den letzten Wurf, automatische Wiederherstellung falls die App mal abstürzt oder geschlossen wird, eine Sprachansage der Punkte (mehrere Stimmen wählbar, auch abschaltbar) und bei Kamera-Scoring ein optionaler KI-Kommentator, der live auf besondere Momente reagiert. Nach dem Spiel lässt sich auf Wunsch ein von KI geschriebener kurzer Spielbericht erstellen. Alle Details dazu in der eigenen Anleitung „Spielmodi & Optionen\" weiter unten.",
        ],
      },
      {
        heading: "Online spielen",
        body: [
          "Statt am selben Gerät lässt sich ein Vereinskollege mit eigenem Account auch direkt herausfordern — das Match läuft dann live und synchron auf zwei Geräten, inklusive Push-Benachrichtigung bei neuer Herausforderung. Modus, Best-of-Legs, Double-In/Out und wer beginnt sind dabei frei einstellbar. Details in der eigenen Anleitung weiter unten.",
        ],
      },
      {
        heading: "Turniere",
        body: [
          "K.O.-Baum oder Round-Robin, bis zu 64 Teilnehmer, mit Turnierserien über mehrere Events hinweg. Für Zuschauer gibt es eine eigene Live-Ansicht per Link oder QR-Code — ganz ohne Login, mit mehreren automatisch rotierenden Perspektiven (laufende Partien, Turnierbaum, Tabelle, Boards, Highlights, u.a.) und sogar einem Zuschauer-Tippspiel, wer eine laufende Partie gewinnt. Der „Board-Modus\" bindet ein Gerät fest an ein bestimmtes Board, das dann selbstständig zur jeweils nächsten anstehenden Partie weiterschaltet. Dazu Anwesenheits-Check-in der Teilnehmer und eine Restzeit-Schätzung für Admins. Alle Details dazu in der eigenen Turnier-Anleitung weiter unten.",
        ],
      },
      {
        heading: "Liga",
        body: [
          "Für eine Runde über mehrere Wochen: jeder gegen jeden mit automatisch erstelltem Spielplan und laufender Tabelle statt Turnierbaum. Auch hier gibt es eine öffentliche Live-Ansicht ohne Login sowie einen Kalender-Export pro Spieltag. Details in der eigenen Liga-Anleitung weiter unten.",
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
          "Ein eigener Trainingsmodus mit Kamera-Kalibrierung und 17 verschiedenen Übungen (Doppel, Finish, Genauigkeit, Drucksituationen) — mit persönlichen Rekorden je Übung, einer Trainings-Streak und einem automatisch erstellten Trainingsplan, der sich direkt an deiner eigenen Aim-Bias-Auswertung, deinem Schnitt und deiner Form orientiert. Details in der eigenen Trainings-Anleitung weiter unten.",
        ],
      },
      {
        heading: "Verein & Einstellungen",
        body: [
          "Admins können Vereinsname, Logo und Farbthema anpassen — jedes Mitglied kann zusätzlich unter „Meine Farbe\" eine eigene Akzentfarbe wählen, ganz ohne Auswirkung auf andere. Die App unterstützt mehrere unabhängige Vereine: ein eigener Verein lässt sich anlegen, neue Mitglieder kommen entweder per gezielter Admin-Einladung oder über einen offenen Beitritts-Link dazu (der dann von einem Admin einzeln bestätigt wird). Neben der klassischen Admin-Rolle gibt es eine „Editor\"-Rolle für Turnier-/Liga-Verwaltung ohne volle Admin-Rechte. Dazu ein editierbares Impressum, ein Admin-Bereich für Nutzerverwaltung inklusive Vereins-Abo, und die App spricht mehrere Sprachen.",
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
          "Oben auf der Statistik-Seite wechselst du mit „Verein\" / „Ich\" zwischen den Zahlen des ganzen Vereins und deinen eigenen — direkt darunter gruppieren fünf Reiter alles weiter. Die Elo-Wertung taucht dabei nicht nur als eigener Wert auf, sondern direkt mit in fast jeder Rangliste. Viele Ansichten lassen sich außerdem nach Spielmodus und Best-of filtern, und einzelne Werte wahlweise als Liste oder als Balkendiagramm anzeigen — im Diagramm auch mehrere Werte gleichzeitig zum Vergleich.",
        ],
      },
      {
        heading: "Übersicht",
        body: [
          "Vereinsrangliste, Vereinsrekorde (meiste 180er, bester Schnitt, höchstes Finish, beste MPR im Cricket, …) und wie viele Spiele zuletzt gelaufen sind — inklusive Zeitverlauf-Chart der letzten 30 Tage. Auf jede Rekord-Kachel kannst du tippen, um die komplette Rangliste für genau diesen Wert zu sehen — nicht nur den einen Spitzenreiter.",
        ],
      },
      {
        heading: "Spieler",
        body: [
          "Wähle ein Vereinsmitglied (oder wechsle oben auf „Ich\" für deine eigenen Werte): Schnitt mit Verlauf, Checkout-Quote, First-9-Schnitt, 180er, eine Triple-Analyse (wie oft eine Aufnahme treble-los blieb), Formkurve der letzten Spiele, und — nur in deiner eigenen Ansicht, für niemand anderen sichtbar — wer dein „Angstgegner\" bzw. Lieblingsgegner ist.",
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
          "Unter „Mehr über mich\" kannst du zusätzlich Wurfhand, Dartgewicht, Lieblings-Doppel, Wohnort, Mitglied-seit-Jahr, einen Leitspruch, einen kleinen Steckbrief-Text (z. B. wie du zum Darten gekommen bist) und Geburtstag hinterlegen — alles freiwillig, taucht dann aber schön aufbereitet auf deinem Profil auf.",
        ],
      },
      {
        heading: "Eigenes Profil bearbeiten",
        body: [
          "Nur du selbst (oder ein Admin bei einem Profil ohne verknüpften Account) kannst ein Profil nachträglich bearbeiten — über den Stift auf der Karte oder im geöffneten Profil. Dort lässt sich auch eine historische 180er-Anzahl aus der Zeit vor der App nachtragen, jahresweise.",
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
          "Spielmodus (501/301/Cricket/extern gespielt) und First-to-Legs für das ganze Turnier. Bei K.O. zusätzlich die Turnierbaum-Größe (am besten „Automatisch\"), verfügbare Boards, ob direkt aus dem Turnierbaum heraus gespielt werden kann, der Auslosungsmodus (zufällig oder manuell), und optional ein abweichender Modus pro Runde (z. B. Finalrunde mit mehr Legs). Bei Round-Robin gibt es statt eines Baums eine laufende Tabelle. Ein „Großevent-Modus\" schaltet zusätzliche Anzeigeoptionen für größere Veranstaltungen frei.",
        ],
      },
      {
        heading: "Teilnehmer",
        body: [
          "Vereinsmitglieder per Klick hinzufügen, per Schnell-Eingabe eintippen, aus einer eingefügten Namensliste übernehmen, die Teilnehmerliste eines vorherigen Turniers übernehmen, oder mit Gast-Platzhaltern auffüllen. Die Teilnehmerliste unten zeigt eine Live-Vorschau des Turnierbaums, sobald genug Spieler eingetragen sind — inklusive Freilosen/Vorrunde, falls die Teilnehmerzahl keine glatte Zweierpotenz ist. Auch nach dem Start lässt sich bei Bedarf noch jemand in einen offenen Slot nachtragen oder ein Teilnehmer zurückziehen (mit Warnung, falls dazu schon offene Partien existieren).",
        ],
      },
      {
        heading: "Turnier starten",
        body: [
          "Ganz unten „Turnier starten\" legt den Turnierbaum an. Danach lässt sich jederzeit direkt aus dem Baum heraus ein Spiel für die anstehende Partie starten. Ein „Scorekeeper\" für den Abend wird dabei automatisch zugelost — bei Bedarf lässt sich neu auslosen.",
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
          "Jedes Turnier hat einen eigenen Teilen-Link (und QR-Code) für eine reine Zuschau-Ansicht — ganz ohne Login, mit Vollbild- und Zoom-Steuerung fürs Wandbildschirm. Sie rotiert automatisch durch mehrere einzeln ein-/ausschaltbare Perspektiven (Turnierbaum, Tabelle, laufende Partien, Boards, Teilnehmerliste, Highlights, Modus-Erklärung, QR-Code) und bietet bei K.O.-Turnieren ein Zuschauer-Tippspiel, wer eine laufende Partie gewinnt. Zusätzlich zum turnierweiten Link gibt es pro Partie einen eigenen QR-Code zum Scannen direkt am Board.",
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
          "Teilnehmer können sich vor Turnierbeginn per Check-in als anwesend markieren — für Admins auch als Sammel-Aktion „alle als anwesend markieren\" bzw. zurücksetzen. Mehrere Turniere lassen sich außerdem zu einer Turnierserie zusammenfassen, mit einer eigenen Serienwertung über alle enthaltenen Events hinweg.",
        ],
      },
      {
        heading: "Nach dem Turnier",
        body: [
          "Admins sehen während des laufenden Turniers eine Restzeit-Schätzung fürs Voranschreiten der Runden. Direkt nach dem entscheidenden Spiel gibt es eine kleine Sieger-Zeremonie mit Konfetti und Fanfare (jederzeit erneut abspielbar), und eine Highlight- und Auswertungsseite fasst danach die besten Momente und Zahlen des Turniers zusammen.",
        ],
      },
    ],
  },
  {
    id: "liga",
    title: "Liga",
    teaser: "Jeder gegen jeden über mehrere Wochen, mit laufender Tabelle.",
    sections: [
      {
        body: [
          "Eine Liga ist die richtige Wahl für eine Runde, die sich über mehrere Wochen zieht, statt an einem Abend entschieden zu werden — jeder gegen jeden, mit laufender Tabelle statt Turnierbaum. Zu finden unter „Liga\".",
        ],
      },
      {
        heading: "Liga anlegen",
        body: [
          "Name, Einfach- oder Hin-und-Rückrunde, Spielmodus (501/301/Cricket) und Best-of-Legs. Dazu die Wahl, ob Ergebnisse aus Online-Matches automatisch übernommen werden oder von Hand eingetragen werden — Format und Teilnehmerliste stehen danach fest, weil der Spielplan direkt daraus erzeugt wird.",
        ],
      },
      {
        heading: "Spielplan & Tabelle",
        body: [
          "Die App erstellt automatisch den kompletten Round-Robin-Spielplan, Runde für Runde. Die Tabelle zeigt Spiele, Siege, Legs und Punkte (2 Punkte pro Sieg), sortiert nach Punkten und bei Gleichstand nach Legdifferenz.",
        ],
      },
      {
        heading: "Ein Spiel starten",
        body: [
          "Aus dem Spielplan heraus auf eine anstehende Partie tippen — entweder als normales Spiel am selben Gerät, oder als Online-Match zwischen den beiden Mitgliedern (genau wie beim direkten Herausfordern, siehe die Anleitung „Online spielen\"). Bei einer Liga mit manueller Ergebniseingabe trägst du stattdessen einfach die Legs beider Spieler ein — auch offline, die Eingabe wird dann automatisch nachgereicht, sobald wieder Verbindung besteht.",
        ],
      },
      {
        heading: "Spieltage & Kalender",
        body: [
          "Wer die Liga angelegt hat, kann jeder Runde ein Datum geben. Ab dann kann JEDES Mitglied den Spieltag per Ein-Klick-Export als Termin (.ics) in den eigenen Kalender übernehmen.",
        ],
      },
      {
        heading: "Öffentliche Live-Ansicht",
        body: [
          "Wie bei Turnieren gibt es einen eigenen Teilen-Link mit QR-Code für eine reine Zuschau-Ansicht ganz ohne Login — zeigt Tabelle und Spielplan read-only und aktualisiert sich automatisch alle paar Sekunden.",
        ],
      },
      {
        heading: "Bearbeiten & Löschen",
        body: [
          "Name, Modus und Best-of-Legs lassen sich jederzeit nachträglich ändern. Die Liga selbst lässt sich (mit Sicherheitsabfrage) auch komplett löschen.",
        ],
      },
    ],
  },
  {
    id: "online-spielen",
    title: "Online spielen",
    teaser: "Ein Vereinsmitglied direkt herausfordern — live auf zwei Geräten.",
    sections: [
      {
        body: [
          "Statt am selben Gerät lässt sich ein anderes Vereinsmitglied mit eigenem Account auch direkt herausfordern, unabhängig von Turnier oder Liga: Das Match läuft danach live und synchron auf beiden Geräten mit — jeder sieht die Würfe des anderen in Echtzeit. Zu finden über „Online spielen\" beim Spiel-Start.",
        ],
      },
      {
        heading: "Wen herausfordern",
        body: [
          "Die Gegnerliste ist nach Elo-Nähe zu deiner eigenen Wertung sortiert, mit einem „Gutes Match\"-Hinweis bei Gegnern innerhalb von 100 Elo-Punkten.",
        ],
      },
      {
        heading: "Einstellungen",
        body: [
          "Modus (501/301/Cricket oder ein frei wählbarer Custom-Startscore) und Best-of-Legs wie gewohnt, dazu Double-In/Double-Out für beide Spieler und wer die erste Aufnahme beginnt (du, dein Gegner, oder per Zufall entschieden).",
        ],
      },
      {
        heading: "Annehmen oder ablehnen",
        body: [
          "Eine offene Herausforderung erscheint auf der Startseite unter „Wer hat mich herausgefordert\" — annehmen startet direkt das Spiel, ablehnen erlaubt optional einen kurzen Kommentar, der dem Herausforderer mitgeschickt wird. Bei neuer Herausforderung sowie Annahme/Ablehnung gibt es jeweils eine Push-Benachrichtigung.",
        ],
      },
      {
        heading: "Laufendes Match wiederfinden",
        body: [
          "Ein bereits angenommenes, noch nicht beendetes Match bleibt als eigene Kachel „Mit … spielen\" auf der Startseite sichtbar, um jederzeit direkt wieder einzusteigen.",
        ],
      },
      {
        heading: "Faire Paarungen für den Vereinsabend",
        body: [
          "Auf der Spieler-Seite lässt sich unter „Faire Paarungen\" außerdem eine ganze Liste anwesender Mitglieder auswählen — die App bildet daraus automatisch Elo-ausgeglichene 1v1-Paarungen (bei ungerader Anzahl mit einem zufälligen Freilos). Über „Neu mischen\" gibt's bei Bedarf eine neue Zufallspaarung.",
        ],
      },
    ],
  },
  {
    id: "training",
    title: "Training",
    teaser: "17 Übungen, persönliche Rekorde, Trainings-Streak, Coaching-Plan.",
    sections: [
      {
        body: [
          "Der Trainingsmodus (eigener Bereich „Training\") bietet gezielte Übungen statt eines normalen Spiels — inklusive Kamera-Kalibrierung, falls mit Kamera trainiert wird.",
        ],
      },
      {
        heading: "Die Übungen",
        body: [
          "17 Drills in vier Kategorien, sortiert wie im Filter oben: Doppel (Bob's 27, Doubles Only), Finish (121 Challenge, Legendary Finishes, Random Finish Drill), Genauigkeit (Around the Clock, Big Single Lock, Ghost Race, Random Score, Target Grind) und Drucksituationen (Bull Control, Combo Risk, Halve It, Pressure Training, Shanghai, Shanghai Round the Clock, Sudden Death). Jede Übung zeigt einen Schwierigkeitsgrad (Anfänger/Fortgeschritten/Profi) und eine Richtzeit. Legendary Finishes, Ghost Race und Combo Risk sind die neuesten drei — eine Checkout-Leiter mit Bronze/Silber/Gold-Stufen, ein Rennen gegen das Tempo des eigenen Rekords, und ein Push-your-luck-Modus mit Bank-Knopf.",
        ],
      },
      {
        heading: "Vor dem Start einstellbar",
        body: [
          "Je nach Übung: ein Rundenlimit, das Zielfeld bei Target Grind (z. B. Triple 20), die Startzahl bei Shanghai Round the Clock, oder Spieleranzahl/Startpunkte/Zielzahl bei Bull Control.",
        ],
      },
      {
        heading: "Deine Fortschritte",
        body: [
          "Zu jeder Übung merkt sich die App deinen persönlichen Rekord auf diesem Gerät, mit einer kleinen Trend-Grafik der letzten Versuche. Dazu eine Trainings-Streak, die zählt, an wie vielen Tagen in Folge du trainiert hast.",
        ],
      },
      {
        heading: "Dein Trainingsplan",
        body: [
          "Unter „Dein Trainingsplan\" schlägt die App automatisch passende Übungen vor — basierend auf deiner Doppelquote, deinem Schnitt, deiner aktuellen Form, deinem Highscore und vor allem deiner eigenen Aim-Bias-Auswertung (wohin du tendenziell danebenwirfst). Ein Tipp startet die empfohlene Übung direkt.",
        ],
      },
    ],
  },
  {
    id: "spielmodi-optionen",
    title: "Spielmodi & Optionen",
    teaser: "Teams, Bots, Geist-Modus, Sets, Handicap und mehr.",
    sections: [
      {
        body: [
          "Das Setup-Fenster beim Spielstart hat deutlich mehr zu bieten als nur den Spielmodus — hier der komplette Überblick über alle Extras.",
        ],
      },
      {
        heading: "Mehrspieler & Teams",
        body: [
          "Statt 1v1 lassen sich mehr Spieler hinzufügen, oder ein echter Team-Modus (2v2 bis 4v4) mit selbst benannten Teams aktivieren.",
        ],
      },
      {
        heading: "Gegen einen Bot",
        body: [
          "Fünf Schwierigkeitsstufen mit jeweils angezeigtem Ziel-Schnitt, ideal zum Üben ohne Mitspieler.",
        ],
      },
      {
        heading: "Geist-Modus",
        body: [
          "Statt gegen einen echten Gegner tritt man gegen die eigene bisherige Bestleistung an — während des Legs zeigt die App live an, ob du gerade vor oder hinter deinem Rekordtempo liegst.",
        ],
      },
      {
        heading: "Handicap & Sets-Modus",
        body: [
          "Ein Handicap gibt einem schwächeren Spieler einen festen Punktevorsprung. Der Sets-Modus baut eine vollständige Profi-Turnierstruktur: „Best of\" Sätze, wobei jeder Satz wiederum „Best of\" Legs entscheidet.",
        ],
      },
      {
        heading: "Vor dem Spiel",
        body: [
          "Ein optionaler Aufwärm-Timer (30–120 Sekunden) mit eigenem Wurf- und Punktezähler. Bei 1v1-Partien mit gemeinsamer Vereinshistorie zeigt eine cinematische Einlaufsequenz zusätzlich einen Stats-Vergleich beider Spieler, die Elo-basierte Gewinnwahrscheinlichkeit und — falls vorhanden — eine automatisch generierte Rivalitäts-Story-Zeile.",
        ],
      },
      {
        heading: "Während des Spiels",
        body: [
          "Eine Sprachansage der Punkte (mehrere Stimmen zur Auswahl, darunter auch Yoda), ein „X Legs in Folge\"-Momentum-Hinweis, Undo für den letzten Wurf, und bei X01 ein optionales Rundenlimit pro Leg. Bei Kamera-Scoring lässt sich zusätzlich ein KI-Kommentator zuschalten, der auf besondere Momente (180er, Finish, Legsieg, überworfen) mit einer kurzen, von KI generierten Zuruf-Zeile reagiert — ein Paid-Feature, das du in der Kamera-Ansicht ein- und ausschalten kannst.",
        ],
      },
      {
        heading: "Nach dem Spiel",
        body: [
          "Auf Wunsch lässt sich ein kurzer, von KI geschriebener Spielbericht zum Match generieren.",
        ],
      },
    ],
  },
];
