export interface SeasonReportLeaderboardRow {
  rank: number;
  name: string;
  gamesPlayed: number;
  gamesWon: number;
  points: number;
  elo: number;
  average: number;
  highScore: number;
  doubleRate: number;
}

export interface SeasonReportHighlight {
  label: string;
  name: string;
  value: string;
}

export interface SeasonReportData {
  clubName: string;
  periodLabel: string;
  totalGames: number;
  totalPlayers: number;
  avgOfAverages: number;
  totalDarts: number;
  highlights: SeasonReportHighlight[];
  leaderboard: SeasonReportLeaderboardRow[];
}

/**
 * Client-side PDF season/year report — the same "gather already-computed leaderboard/club
 * stats → render → download" pattern as the existing CSV export, just with a fuller layout
 * (highlights, club summary) that a spreadsheet can't really present. jsPDF (+ autotable,
 * + its html2canvas dependency) is ~230KB — loaded on demand here instead of the main
 * bundle, since most sessions never click "PDF export".
 */
export async function generateSeasonReportPdf(data: SeasonReportData): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(20, 20, 30);
  doc.text(data.clubName, margin, 56);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(90, 90, 100);
  doc.text(`Saisonbericht · ${data.periodLabel}`, margin, 76);
  doc.setFontSize(9);
  doc.text(`Erstellt am ${new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}`, margin, 92);

  doc.setDrawColor(220, 220, 225);
  doc.line(margin, 104, pageWidth - margin, 104);

  // Club summary
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 30);
  doc.text("Vereinsübersicht", margin, 128);

  autoTable(doc, {
    startY: 136,
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: { fontSize: 10, cellPadding: { top: 3, bottom: 3, left: 0, right: 8 } },
    body: [
      ["Gespielte Partien", String(data.totalGames)],
      ["Aktive Spieler", String(data.totalPlayers)],
      ["Ø Average (Verein)", data.avgOfAverages.toFixed(1)],
      ["Geworfene Darts", data.totalDarts.toLocaleString("de-DE")],
    ],
  });

  // Highlights
  const afterSummaryY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Highlights", margin, afterSummaryY);

  autoTable(doc, {
    startY: afterSummaryY + 8,
    margin: { left: margin, right: margin },
    head: [["Kategorie", "Spieler", "Wert"]],
    body: data.highlights.map((h) => [h.label, h.name, h.value]),
    theme: "striped",
    headStyles: { fillColor: [16, 130, 140] },
    styles: { fontSize: 9.5 },
  });

  // Leaderboard (new page for breathing room)
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20, 20, 30);
  doc.text(`Bestenliste · ${data.periodLabel}`, margin, 50);

  autoTable(doc, {
    startY: 64,
    margin: { left: margin, right: margin },
    head: [["#", "Name", "Spiele", "Siege", "Punkte", "Elo", "Ø Average", "Highscore", "Checkout %"]],
    body: data.leaderboard.map((r) => [
      String(r.rank), r.name, String(r.gamesPlayed), String(r.gamesWon), String(r.points),
      String(r.elo), r.average.toFixed(1), String(r.highScore), `${r.doubleRate.toFixed(0)}%`,
    ]),
    theme: "striped",
    headStyles: { fillColor: [16, 130, 140] },
    styles: { fontSize: 9 },
    columnStyles: { 0: { cellWidth: 24 } },
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 155);
    doc.text(`Seite ${i} / ${pageCount}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 20, { align: "right" });
  }

  const suffix = data.periodLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  doc.save(`saisonbericht-${suffix || "gesamt"}.pdf`);
}
