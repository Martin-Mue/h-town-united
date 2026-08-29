import type { Language } from "@/i18n/translations";

export interface ChangelogEntry {
  /** Stable, sortable ID — also the "have you seen this yet" comparison key (see
   *  WhatsNewBanner.tsx), so once published, NEVER change or reuse an id, only append new ones. */
  id: string;
  /** ISO date, just for display under the title. */
  date: string;
  title: Record<Language, string>;
  description: Record<Language, string>;
}

/** Short, non-technical "what's new" entries shown to returning users — see WhatsNewBanner.tsx
 *  for how these get bundled and dismissed. Newest last; the banner sorts by id itself, but
 *  keeping the file in chronological order makes it easier to append the next entry correctly. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-08-26-highlights",
    date: "2026-08-26",
    title: {
      de: "Turnier-Highlights überarbeitet",
      en: "Tournament highlights overhauled",
      fr: "Highlights du tournoi revus",
      pl: "Odświeżone najlepsze momenty turnieju",
      nl: "Toernooi-highlights vernieuwd",
      tr: "Turnuva öne çıkanları yenilendi",
    },
    description: {
      de: "Neue Spalten (100+ bis 180, Checkout, Darts bis zum Checkout), anklickbare Spaltenköpfe zum Sortieren, und jede Partie lässt sich jetzt Leg für Leg aufklappen.",
      en: "New columns (100+ through 180, checkout, darts to checkout), clickable column headers to sort, and every match can now be expanded leg by leg.",
      fr: "Nouvelles colonnes (100+ à 180, checkout, fléchettes jusqu'au checkout), en-têtes de colonnes cliquables pour trier, et chaque match peut désormais être développé leg par leg.",
      pl: "Nowe kolumny (100+ do 180, checkout, lotki do checkoutu), klikalne nagłówki kolumn do sortowania, a każdy mecz można teraz rozwinąć leg po legu.",
      nl: "Nieuwe kolommen (100+ t/m 180, checkout, darts tot checkout), klikbare kolomkoppen om te sorteren, en elke wedstrijd is nu leg voor leg uit te klappen.",
      tr: "Yeni sütunlar (100+'dan 180'e, checkout, checkout'a kadar dart), sıralamak için tıklanabilir sütun başlıkları ve artık her maç leg leg açılabiliyor.",
    },
  },
  {
    id: "2026-08-26-darts-to-checkout",
    date: "2026-08-26",
    title: {
      de: "Darts bis zum Checkout überall sichtbar",
      en: "Darts-to-checkout everywhere",
      fr: "Fléchettes jusqu'au checkout partout",
      pl: "Lotki do checkoutu wszędzie widoczne",
      nl: "Darts tot checkout overal zichtbaar",
      tr: "Checkout'a kadar dart her yerde görünür",
    },
    description: {
      de: "Vereinsstatistik, Spielstatistik und Turnier-Highlights zeigen jetzt, wie wenige Darts jemand bis zum Checkout gebraucht hat — inklusive persönlichem Bestwert in der Rangliste.",
      en: "Club stats, post-match stats, and tournament highlights now show how few darts it took someone to check out — including a personal-best ranking.",
      fr: "Les statistiques du club, les statistiques post-match et les highlights du tournoi affichent désormais le nombre de fléchettes nécessaires pour un checkout — avec un classement du meilleur score personnel.",
      pl: "Statystyki klubu, statystyki po meczu i najlepsze momenty turnieju pokazują teraz, ile lotek potrzeba było do checkoutu — wraz z rankingiem rekordu osobistego.",
      nl: "Clubstatistieken, statistieken na de wedstrijd en toernooi-highlights tonen nu hoe weinig darts iemand nodig had om uit te checken — inclusief een persoonlijk-beste ranglijst.",
      tr: "Kulüp istatistikleri, maç sonrası istatistikler ve turnuva öne çıkanları artık birinin checkout için kaç dart attığını gösteriyor — kişisel en iyi sıralamasıyla birlikte.",
    },
  },
  {
    id: "2026-08-26-bot-variance",
    date: "2026-08-26",
    title: {
      de: "Bots fühlen sich echter an",
      en: "Bots feel more real",
      fr: "Les bots semblent plus réels",
      pl: "Boty czują się bardziej realistyczne",
      nl: "Bots voelen echter aan",
      tr: "Botlar daha gerçek hissettiriyor",
    },
    description: {
      de: "Jeder Bot-Gegner hat jetzt bessere und schlechtere Legs, statt jedes Mal exakt gleich zu spielen — genau wie ein echter Gegner auch mal einen besseren oder schlechteren Tag hat.",
      en: "Every bot opponent now has better and worse legs instead of always playing exactly the same — just like a real opponent has a better or worse day sometimes.",
      fr: "Chaque adversaire bot a désormais des legs meilleurs et moins bons au lieu de toujours jouer exactement pareil — tout comme un vrai adversaire a parfois un meilleur ou moins bon jour.",
      pl: "Każdy przeciwnik-bot ma teraz lepsze i gorsze legi, zamiast zawsze grać dokładnie tak samo — tak jak prawdziwy przeciwnik miewa lepsze i gorsze dni.",
      nl: "Elke bot-tegenstander heeft nu betere en slechtere legs in plaats van steeds precies hetzelfde te spelen — net als een echte tegenstander wel eens een betere of slechtere dag heeft.",
      tr: "Her bot rakip artık her zaman aynı şekilde oynamak yerine daha iyi ve daha kötü leg'lere sahip — tıpkı gerçek bir rakibin bazen daha iyi ya da daha kötü bir günü olması gibi.",
    },
  },
  {
    id: "2026-08-26-tournament-tabs",
    date: "2026-08-26",
    title: {
      de: "Turnierliste: Aktiv & Abgeschlossen",
      en: "Tournament list: Active & Finished",
      fr: "Liste des tournois : actifs et terminés",
      pl: "Lista turniejów: aktywne i zakończone",
      nl: "Toernooilijst: actief & afgerond",
      tr: "Turnuva listesi: Aktif ve Tamamlanan",
    },
    description: {
      de: "Abgeschlossene Turniere landen jetzt in einem eigenen Tab, statt sich mit den laufenden in einer Liste zu stapeln.",
      en: "Finished tournaments now live in their own tab instead of piling up together with the ones still running.",
      fr: "Les tournois terminés ont désormais leur propre onglet au lieu de s'accumuler avec ceux en cours.",
      pl: "Zakończone turnieje mają teraz własną zakładkę, zamiast piętrzyć się razem z trwającymi.",
      nl: "Afgeronde toernooien staan nu in een eigen tab in plaats van zich op te stapelen bij de lopende.",
      tr: "Tamamlanan turnuvalar artık devam edenlerle üst üste yığılmak yerine kendi sekmesinde yer alıyor.",
    },
  },
  {
    id: "2026-08-28-score-entry-layout",
    date: "2026-08-28",
    title: {
      de: "Punkteingabe passt sich jedem Gerät an",
      en: "Score entry adapts to every device",
      fr: "La saisie des scores s'adapte à chaque appareil",
      pl: "Wprowadzanie wyników dopasowuje się do każdego urządzenia",
      nl: "Scoreinvoer past zich aan elk apparaat aan",
      tr: "Skor girişi her cihaza uyum sağlıyor",
    },
    description: {
      de: "Im Querformat (z. B. auf dem iPad) war die Punkteingabe bisher schmal wie auf dem Handy, und Checkout-Vorschläge konnten beim Scrollen aus dem Blick geraten. Jetzt nutzt die Ansicht die volle Breite, alles Wichtige bleibt sichtbar, und die Schnelleingabe hat mehr gängige Zahlen wie 66, 62 und 96.",
      en: "In landscape (e.g. on an iPad), score entry used to stay phone-narrow, and checkout suggestions could scroll out of view. The screen now uses the full width, everything important stays visible, and quick-entry has more common numbers like 66, 62, and 96.",
      fr: "En mode paysage (par ex. sur iPad), la saisie des scores restait aussi étroite que sur téléphone, et les suggestions de checkout pouvaient disparaître en faisant défiler. L'écran utilise désormais toute la largeur, tout l'essentiel reste visible, et la saisie rapide propose plus de nombres courants comme 66, 62 et 96.",
      pl: "W trybie poziomym (np. na iPadzie) wprowadzanie wyników pozostawało wąskie jak na telefonie, a podpowiedzi checkoutu mogły znikać podczas przewijania. Ekran wykorzystuje teraz pełną szerokość, wszystko ważne pozostaje widoczne, a szybkie wprowadzanie ma więcej typowych liczb, jak 66, 62 i 96.",
      nl: "In liggende stand (bijv. op een iPad) bleef de scoreinvoer smal als op een telefoon, en checkout-suggesties konden tijdens het scrollen uit beeld verdwijnen. Het scherm gebruikt nu de volle breedte, alles belangrijks blijft zichtbaar, en snelinvoer heeft meer gangbare getallen zoals 66, 62 en 96.",
      tr: "Yatay modda (ör. iPad'de) skor girişi telefon genişliğinde kalıyordu ve checkout önerileri kaydırırken görünmez olabiliyordu. Ekran artık tam genişliği kullanıyor, önemli her şey görünür kalıyor ve hızlı girişte 66, 62 ve 96 gibi daha yaygın sayılar var.",
    },
  },
  {
    id: "2026-08-28-score-readability",
    date: "2026-08-28",
    title: {
      de: "Punkteanzeige besser lesbar aus der Ferne",
      en: "Score display easier to read from a distance",
      fr: "Affichage du score plus lisible à distance",
      pl: "Wyświetlacz wyniku czytelniejszy z odległości",
      nl: "Scoreweergave beter leesbaar op afstand",
      tr: "Skor ekranı uzaktan daha okunaklı",
    },
    description: {
      de: "Die aktuelle Punktzahl, Checkout-Vorschläge und die geworfenen Darts dieser Aufnahme sind jetzt deutlich größer — gut lesbar auch etwas weiter vom Gerät entfernt. Außerdem lässt sich die Seite während eines laufenden Spiels nicht mehr versehentlich per Wisch-Geste neu laden.",
      en: "The current score, checkout suggestions, and this round's thrown darts are now noticeably bigger — easy to read even a bit further from the device. Also, the page can no longer be accidentally reloaded mid-game with a swipe gesture.",
      fr: "Le score actuel, les suggestions de checkout et les fléchettes lancées ce tour sont désormais nettement plus grands — faciles à lire même un peu plus loin de l'appareil. De plus, la page ne peut plus être rechargée accidentellement en cours de partie par un geste de balayage.",
      pl: "Aktualny wynik, podpowiedzi checkoutu i lotki rzucone w tej turze są teraz wyraźnie większe — dobrze czytelne nawet z pewnej odległości od urządzenia. Dodatkowo strony nie da się już przypadkowo odświeżyć gestem przesunięcia w trakcie gry.",
      nl: "De huidige score, checkout-suggesties en de darts die deze ronde zijn gegooid, zijn nu duidelijk groter — goed leesbaar, ook iets verder van het apparaat vandaan. Daarnaast kan de pagina tijdens een lopende partij niet meer per ongeluk via een veegbeweging opnieuw worden geladen.",
      tr: "Güncel skor, checkout önerileri ve bu turda atılan dartlar artık belirgin şekilde daha büyük — cihazdan biraz uzaktan bile rahatça okunabiliyor. Ayrıca oyun sürerken sayfa artık kaydırma hareketiyle yanlışlıkla yeniden yüklenemiyor.",
    },
  },
  {
    id: "2026-08-29-checkout-suggestions-toggle",
    date: "2026-08-29",
    title: {
      de: "Checkout-Vorschläge abschaltbar",
      en: "Checkout suggestions can be turned off",
      fr: "Suggestions de finish désactivables",
      pl: "Możliwość wyłączenia podpowiedzi checkout",
      nl: "Checkout-suggesties uit te schakelen",
      tr: "Checkout önerileri kapatılabilir",
    },
    description: {
      de: "Neuer Schalter im Spiel-Setup: Die Auslege-Route lässt sich jetzt ausblenden. In Turnierspielen ist das jetzt der Standard (kein Vorschlag), bleibt dort aber pro Match änderbar.",
      en: "New switch in the game setup: the finishing route can now be hidden. Tournament matches now default to it being off, but it stays adjustable per match there too.",
      fr: "Nouvel interrupteur dans la configuration de partie : le chemin de finish peut désormais être masqué. Dans les matchs de tournoi, il est maintenant désactivé par défaut, mais reste modifiable par match.",
      pl: "Nowy przełącznik w ustawieniach gry: sugerowaną drogę zamknięcia można teraz ukryć. W meczach turniejowych jest teraz domyślnie wyłączona, ale nadal można to zmienić dla każdego meczu.",
      nl: "Nieuwe schakelaar in de spelinstellingen: de uitgooiroute kan nu worden verborgen. Bij toernooiwedstrijden staat dit voortaan standaard uit, maar blijft per wedstrijd aanpasbaar.",
      tr: "Oyun kurulumunda yeni bir anahtar: bitiriş rotası artık gizlenebilir. Turnuva maçlarında artık varsayılan olarak kapalı, ancak maç bazında yine de değiştirilebilir.",
    },
  },
];
