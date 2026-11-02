// #5074: the keyboard must resize the /v3 layout so the composer stays visible. This pins the
// setting and its rendered tag; whether a given phone honours it is only provable on the device.
import { describe, expect, it } from "vitest";
import { viewport } from "@/app/v3/layout";

describe("#5074 keyboard does not cover the /v3 composer", () => {
  it("asks the browser to resize the layout, not just the visual viewport", () => {
    expect(viewport.interactiveWidget).toBe("resizes-content");
  });
  it("control: it does not pin zoom or width (Next's defaults still apply)", () => {
    expect(Object.keys(viewport)).toEqual(["interactiveWidget"]);
  });
});
