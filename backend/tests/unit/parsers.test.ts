import { describe, expect, it } from "vitest";
import { detectFormat, ParseError, parseCsv, parseJson, parseNdjson } from "../../src/ingestion/parsers.js";

describe("parsers", () => {
  it("detects formats from file names", () => {
    expect(detectFormat("a.CSV")).toBe("csv");
    expect(detectFormat("a.json")).toBe("json");
    expect(detectFormat("a.jsonl")).toBe("ndjson");
    expect(detectFormat("a.txt")).toBeNull();
  });

  it("parses CSV with quoted fields and JSON columns", () => {
    const rows = parseCsv('post_id,text,media\n1,"Hello, ""world""","[{""type"":""image""}]"\n2,plain,\n');
    expect(rows).toEqual([
      { post_id: "1", text: 'Hello, "world"', media: [{ type: "image" }] },
      { post_id: "2", text: "plain" },
    ]);
  });

  it("parses JSON arrays and {posts: []} wrappers", () => {
    expect(parseJson("[{\"a\":1}]")).toEqual([{ a: 1 }]);
    expect(parseJson("{\"posts\":[{\"a\":1}],\"synthetic\":true}")).toEqual([{ a: 1 }]);
  });

  it("throws ParseError for malformed JSON", () => {
    expect(() => parseJson("{nope")).toThrow(ParseError);
    expect(() => parseJson("42")).toThrow(ParseError);
  });

  it("marks bad NDJSON lines instead of failing the file", () => {
    const rows = parseNdjson('{"a":1}\nnot json\n\n{"b":2}');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({ __parse_error: "line 2 is not valid JSON" });
  });
});
