// A JSON Schema reader for the keywords `fleet agent schema` uses, and no
// others: what the adapter holds a request to before any verb runs.
//
// THE KEYWORDS ARE A CLOSED SET. The generator (scripts/types.ts) and this
// reader both refuse one they have never met, so a contract that grows a
// keyword stops `deno task types` and every test, and is read by a person
// before anything is taken as valid under it.
//
// THE BD PACK'S READER, reused (adapters/store/bd/.../lib/schema.ts at
// fleet-packs 37d01bc), with one shape the store contract never had: a map,
// an object whose `additionalProperties` is a schema its every value is held
// to (launch's `env`).

export const KEYWORDS: ReadonlySet<string> = new Set([
  "$ref",
  "additionalProperties",
  "anyOf",
  "const",
  "default",
  "description",
  "enum",
  "format",
  "items",
  "maximum",
  "minimum",
  "oneOf",
  "pattern",
  "properties",
  "required",
  "type",
]);

export type Schema = { [key: string]: unknown } | boolean;

/** A schema document whose `$ref`s point into its own `$defs`. */
export interface Document {
  $defs: { [name: string]: Schema };
}

function kind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return typeof value;
}

function isType(value: unknown, type: string): boolean {
  const is = kind(value);
  return is === type || (type === "number" && is === "integer");
}

/** JSON equality, for `const` and `enum`. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function shown(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/**
 * Why `value` does not read as `schema`, naming where, or `null` where it
 * does. `at` is the path so far, `$` for the value itself.
 */
export function why(
  document: Document,
  schema: Schema,
  value: unknown,
  at = "$",
): string | null {
  if (schema === true) return null;
  if (schema === false) return `${at} is not allowed`;
  for (const word of Object.keys(schema)) {
    if (!KEYWORDS.has(word)) {
      throw new Error(
        `the contract uses ${word}, which this reader has never met`,
      );
    }
  }
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace(/^#\/\$defs\//, "");
    const target = document.$defs[name];
    if (target === undefined) {
      throw new Error(`no $defs/${name} in the contract`);
    }
    const found = why(document, target, value, at);
    if (found !== null) return found;
  }
  if ("const" in schema && !same(schema.const, value)) {
    return `${at} is ${shown(value)}, and it is ${shown(schema.const)}`;
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((member) => same(member, value))
  ) {
    return `${at} is ${shown(value)}, which is none of ${shown(schema.enum)}`;
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => isType(value, type as string))) {
      return `${at} is ${shown(value)}, which is not ${types.join(" or ")}`;
    }
  }
  if (typeof value === "string" && typeof schema.pattern === "string") {
    if (!new RegExp(schema.pattern).test(value)) {
      return `${at} is ${shown(value)}, which does not match ${schema.pattern}`;
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      return `${at} is ${value}, below ${schema.minimum}`;
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      return `${at} is ${value}, above ${schema.maximum}`;
    }
    // The formats fleet's schema names are Rust's integer widths: an unsigned
    // one takes no negative number.
    if (
      typeof schema.format === "string" && schema.format.startsWith("uint") &&
      value < 0
    ) {
      return `${at} is ${value}, and it is unsigned`;
    }
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    for (const [n, item] of value.entries()) {
      const found = why(document, schema.items as Schema, item, `${at}[${n}]`);
      if (found !== null) return found;
    }
  }
  if (kind(value) === "object") {
    const object = value as { [key: string]: unknown };
    const properties = (schema.properties ?? {}) as { [key: string]: Schema };
    for (const name of (schema.required ?? []) as string[]) {
      if (!(name in object)) return `${at} carries no ${name}`;
    }
    for (const [name, held] of Object.entries(object)) {
      const property = properties[name];
      if (property !== undefined) {
        const found = why(document, property, held, `${at}.${name}`);
        if (found !== null) return found;
      } else if (schema.additionalProperties === false) {
        return `${at} carries ${name}, which it does not name`;
      } else if (
        typeof schema.additionalProperties === "object" &&
        schema.additionalProperties !== null
      ) {
        // A map's values, each held to the one schema: launch's `env`.
        const found = why(
          document,
          schema.additionalProperties as Schema,
          held,
          `${at}.${name}`,
        );
        if (found !== null) return found;
      }
    }
  }
  for (const word of ["anyOf", "oneOf"] as const) {
    const members = schema[word];
    if (!Array.isArray(members)) continue;
    const reasons = members.map((member) =>
      why(document, member as Schema, value, at)
    );
    const matched = reasons.filter((reason) => reason === null).length;
    if (matched === 0) return deepest(reasons as string[]);
    if (matched > 1 && word === "oneOf") {
      return `${at} reads as more than one of its forms`;
    }
  }
  return null;
}

/**
 * Of the reasons each form of a union refused a value, the one that reached
 * furthest into it, and at the same depth one that is not a missed `const`,
 * `enum` or `type` — a form the value never was: an entry of kind `held` is
 * best told why it is not a `held`, and not that its kind is not `ordered`.
 */
function deepest(reasons: string[]): string {
  const missed = [", and it is ", ", which is none of ", ", which is not "];
  const depth = (reason: string) =>
    reason.split(" ")[0].length * 2 +
    (missed.some((words) => reason.includes(words)) ? 0 : 1);
  return reasons.reduce((best, reason) =>
    depth(reason) > depth(best) ? reason : best
  );
}
