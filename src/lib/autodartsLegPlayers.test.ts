import { describe, it, expect } from "vitest";
import { buildAutodartsLegPlayers } from "./autodartsLegPlayers";

const players = [
  { name: "Martin", isBot: false },
  { name: "Bot", isBot: true },
  { name: "Anna", isBot: false },
];

describe("buildAutodartsLegPlayers", () => {
  it("starts with the leg's starter and leaves bots out", () => {
    const result = buildAutodartsLegPlayers(players, 2, { hostSlot: 0, logins: {} });
    expect(result).toEqual([
      { kind: "guest", name: "Anna" },
      { kind: "host", name: "Martin" },
    ]);
  });

  it("uses a confirmed login only while the slot still holds the same player", () => {
    const logins = { 2: { loginId: "l1", username: "anna_ad", playerName: "Anna" } };
    expect(buildAutodartsLegPlayers(players, 0, { hostSlot: null, logins })).toEqual([
      { kind: "guest", name: "Martin" },
      { kind: "login", name: "Anna", login_id: "l1" },
    ]);
    const renamed = [players[0], players[1], { name: "Tom", isBot: false }];
    expect(buildAutodartsLegPlayers(renamed, 0, { hostSlot: null, logins })[1]).toEqual({ kind: "guest", name: "Tom" });
  });

  it("online: only this device's own player", () => {
    expect(buildAutodartsLegPlayers(players, 0, { hostSlot: 2, logins: {}, onlySlot: 2 })).toEqual([{ kind: "host", name: "Anna" }]);
  });
});
