import { describe, expect, it } from "vitest";
import { buildPetSlashCommands } from "./pet-slash-commands";

describe("buildPetSlashCommands", () => {
  it("offers only the two Paseo client commands when the remote list is empty", () => {
    expect(buildPetSlashCommands([])).toEqual([
      {
        name: "exit",
        insert: "/exit ",
        label: "归档当前会话",
        source: "paseo",
      },
      {
        name: "clear",
        insert: "/clear ",
        label: "清空并新建会话",
        source: "paseo",
      },
    ]);
  });

  it("adds the remote commands in daemon order before the client commands", () => {
    expect(
      buildPetSlashCommands([
        { name: "compact", description: "Compact the context" },
        { name: "paseo-advisor", description: "Ask an advisor" },
      ]).map((command) => command.name),
    ).toEqual(["compact", "paseo-advisor", "exit", "clear"]);
  });
});
