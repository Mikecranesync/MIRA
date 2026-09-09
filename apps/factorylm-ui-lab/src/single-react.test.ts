import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import { findReactDuplication } from "./single-react";

const LAB_DIR = resolve(import.meta.dir, "..");
const UI_PACKAGE_DIR = resolve(import.meta.dir, "../../../packages/factorylm-ui");

// A directory carrying its own copies of the shared modules — the shape a plain
// `bun install` leaves in packages/factorylm-ui when bootstrap:ui has not
// relinked it. Built here rather than mutating the real tree so the negative
// case is deterministic and leaves no residue.
function makeTreeWithOwnReact(): string {
  const root = mkdtempSync(join(tmpdir(), "flm-single-react-"));
  for (const name of ["react", "react-dom"]) {
    const dir = join(root, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "19.2.4", main: "index.js" }));
    writeFileSync(join(dir, "index.js"), "module.exports = {};\n");
  }
  return root;
}

const duplicateTree = makeTreeWithOwnReact();
const emptyTree = mkdtempSync(join(tmpdir(), "flm-no-react-"));

afterAll(() => {
  rmSync(duplicateTree, { recursive: true, force: true });
  rmSync(emptyTree, { recursive: true, force: true });
});

describe("findReactDuplication", () => {
  test("is silent when the lab and @factorylm/ui resolve to one instance", () => {
    // The real tree, as `bootstrap:ui` leaves it. If this ever returns a
    // message, the bootstrap symlink is gone and the shell suites are about to
    // fail with "Invalid hook call".
    expect(findReactDuplication(LAB_DIR, UI_PACKAGE_DIR)).toBeNull();
  });

  test("names both resolved paths when two instances would load", () => {
    const message = findReactDuplication(LAB_DIR, duplicateTree);

    expect(message).not.toBeNull();
    expect(message).toContain("react: two instances");
    expect(message).toContain("react-dom: two instances");
    // The cure has to be in the message: the whole point is that the reader
    // should not have to trace an "Invalid hook call" back to install state.
    expect(message).toContain("Reinstall from the");
  });

  test("reports a module that does not resolve from the package at all", () => {
    // The other way bootstrap:ui gets skipped — the package's dependencies were
    // never installed, which surfaces as `Cannot find package 'react'`.
    const message = findReactDuplication(LAB_DIR, emptyTree);

    expect(message).not.toBeNull();
    expect(message).toContain("not resolvable from @factorylm/ui");
    expect(message).toContain("Reinstall from the");
  });
});
