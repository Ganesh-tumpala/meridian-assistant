import { describe, expect, it } from "vitest";
import { findUngrounded } from "../lib/grounding";

const FACTS = `
The lost card line on 0800 555 0199 is open 24 hours.
The unarranged overdraft fee is 6 pounds per day, capped at 60 pounds per calendar month.
The general phone line is open Monday to Saturday 08:00 to 22:00.
`;

describe("findUngrounded", () => {
  it("returns nothing for a phone number that is in the fact sheet", () => {
    const reply = "You can call 0800 555 0199 any time.";
    expect(findUngrounded(reply, FACTS)).toEqual([]);
  });

  it("flags a phone number that is not in the fact sheet", () => {
    const reply = "You can call 0800 555 0123 any time.";
    expect(findUngrounded(reply, FACTS)).toEqual([
      { kind: "phone", value: "0800 555 0123" },
    ]);
  });

  it("treats £6 and 6 pounds as the same amount", () => {
    const reply = "The fee is £6 per day.";
    expect(findUngrounded(reply, FACTS)).toEqual([]);
  });

  it("flags a time that is not in the fact sheet, even next to one that is", () => {
    const reply = "Our lines are open 07:00 to 22:00, which is longer than advertised.";
    expect(findUngrounded(reply, FACTS)).toEqual([
      { kind: "time", value: "07:00" },
    ]);
  });

  it("returns nothing, and does not crash, on an empty reply", () => {
    expect(findUngrounded("", FACTS)).toEqual([]);
  });
});
