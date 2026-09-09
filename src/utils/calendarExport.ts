/**
 * Minimal .ics (iCalendar, RFC 5545) generator + download trigger — for a league "Spieltag"
 * (matchday) date, so a player can add it to whatever calendar app they actually use instead of
 * having to remember to check back in Dartspot. All-day events only (league_fixtures.scheduled_date
 * is a plain date, no time-of-day field), which keeps this deliberately small: no timezone
 * handling needed at all for a DATE-only VEVENT.
 *
 * Same Blob → object URL → temporary `<a download>` → click → revoke pattern as
 * shareResultImage.ts's shareOrDownloadResultImage — proven, no library needed for something this
 * small, and consistent with how this project already does client-side file downloads.
 */

function icsEscape(text: string): string {
  // RFC 5545 §3.3.11 — the only characters that need escaping in a TEXT value.
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** "2026-09-15" -> "20260915" (VALUE=DATE format). Deliberately string-sliced, not routed through
 *  `new Date(...)` — that would parse in the browser's local timezone and could shift the date by
 *  one day right at midnight in some timezones, which is exactly wrong for a date-only field that
 *  has no time-of-day/timezone concept to begin with. */
function toIcsDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

/** One day after `isoDate`, same YYYYMMDD shape — VEVENT all-day events use an EXCLUSIVE end date
 *  per RFC 5545 (DTEND is the first moment NOT part of the event), so a single-day matchday needs
 *  DTEND = DTSTART + 1 day, not DTSTART itself, or every calendar app would render it as zero-length. */
function toIcsDateExclusiveEnd(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}${String(next.getUTCMonth() + 1).padStart(2, "0")}${String(next.getUTCDate()).padStart(2, "0")}`;
}

export interface IcsEventParams {
  /** Plain "YYYY-MM-DD" date, e.g. league_fixtures.scheduled_date. */
  date: string;
  title: string;
  description?: string;
  /** Stable id for this event (e.g. `league-${leagueId}-round-${round}`) — lets a calendar app
   *  recognize a re-downloaded .ics for the same matchday as an UPDATE to the same event rather
   *  than a duplicate, if the date is later changed and re-exported. */
  uid: string;
}

function buildIcsEvent({ date, title, description, uid }: IcsEventParams): string {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dartspot//Liga-Spieltag//DE",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}@dartspot`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${toIcsDate(date)}`,
    `DTEND;VALUE=DATE:${toIcsDateExclusiveEnd(date)}`,
    `SUMMARY:${icsEscape(title)}`,
    ...(description ? [`DESCRIPTION:${icsEscape(description)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // RFC 5545 §3.1 requires CRLF line endings — most calendar apps tolerate bare \n, but this
  // costs nothing to get right and avoids being the one app that doesn't.
  return lines.join("\r\n");
}

/** Builds the .ics and triggers a browser download — no Web Share API attempt (unlike
 *  shareOrDownloadResultImage's image case) since the point of a calendar file is specifically to
 *  hand it to the OS's own calendar app via its file-open association, which a plain download
 *  already does everywhere this matters. */
export function downloadIcsEvent(params: IcsEventParams, filename: string) {
  const ics = buildIcsEvent(params);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
