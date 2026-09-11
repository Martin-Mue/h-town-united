/** Client-side helpers for "PIN pro Spieler" — a one-time 4-digit PIN a club member can set,
 *  entered to confirm they're really the person being picked as a local (same-device) opponent
 *  in Game.tsx's setup form. Deliberately lightweight: the PIN itself is never sent to or stored
 *  on the server in plaintext, only a salted SHA-256 hash (via the set_player_pin RPC, see the
 *  matching migration), and verification happens fully client-side against that hash once the
 *  club roster (usePlayers/ClubPlayer, which already carries pin_hash/pin_salt for every member)
 *  is loaded — so it works offline, no network round-trip needed at the point someone's picked.
 *
 *  This is NOT a real security boundary. A 4-digit PIN has only 10 000 possible values, and
 *  every club member's client already reads every other member's pin_hash/pin_salt (same as any
 *  other roster field) — so anyone willing to actually attack it, rather than just avoid being
 *  impersonated by a friend grabbing the wrong name, could brute-force it trivially offline.
 *  It's a casual "is this really you" confirmation among club mates, nothing more. */

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fresh random 16-byte hex salt — generate a new one each time a PIN is set or changed. */
export function generatePinSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

/** SHA-256(salt + ":" + pin), hex-encoded. Never send the raw pin anywhere else. */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

/** Checks a 4-digit PIN against a stored hash+salt — the whole point being this needs no
 *  server call, so it works offline at the moment a local opponent is being picked. */
export async function verifyPin(pin: string, salt: string, hash: string): Promise<boolean> {
  if (!salt || !hash) return false;
  return (await hashPin(pin, salt)) === hash;
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
