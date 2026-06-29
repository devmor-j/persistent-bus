import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorToString } from "../src/utils/utility.ts";

describe("errorToString", () => {
  it("returns 'none' for null/undefined", () => {
    assert.equal(errorToString(null), "none");
    assert.equal(errorToString(undefined), "none");
  });

  it("returns message for Error instance", () => {
    assert.equal(
      errorToString(new Error("something broke")),
      "something broke",
    );
  });

  it("returns the string itself when given a string", () => {
    assert.equal(errorToString("raw error"), "raw error");
  });

  it("extracts message from object with message property", () => {
    assert.equal(errorToString({ message: "msg" }), "msg");
  });

  it("extracts error from object with error property", () => {
    assert.equal(errorToString({ error: "err" }), "err");
  });

  it("handles nested error in error property", () => {
    assert.equal(errorToString({ error: new Error("nested") }), "nested");
  });

  it("JSON stringifies plain objects", () => {
    assert.equal(errorToString({ a: 1 }), '{"a":1}');
  });

  it("returns 'none' for falsy primitives", () => {
    assert.equal(errorToString(0), "none");
    assert.equal(errorToString(false), "none");
  });

  it("converts non-falsy primitive via String()", () => {
    assert.equal(errorToString(true), "true");
  });

  it("passes explicit string through", () => {
    assert.equal(errorToString("explicit"), "explicit");
  });

  it("falls back to stack when Error has empty message", () => {
    const err = new Error("");
    // Error with empty message should fall back to stack
    const result = errorToString(err);
    assert.ok(result.length > 0);
  });

  it("converts Error with only message property via object path", () => {
    const result = errorToString({ message: "custom" });
    assert.equal(result, "custom");
  });

  it("handles error object with nested error property calling errorToString", () => {
    const result = errorToString({ error: { message: "nested-deep" } });
    assert.equal(result, "nested-deep");
  });

  it("stringifies objects without message or error property", () => {
    const result = errorToString({ code: 500, reason: "fail" });
    assert.equal(result, '{"code":500,"reason":"fail"}');
  });
});
