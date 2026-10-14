// main.ts end to end: the executable itself, run as fleet runs it — one
// process per call, the request on stdin, the answer on stdout, the exit by
// the contract's table, and stderr's last line for people. No arm here runs
// Claude Code: capabilities runs none, and each other verb's own arms are
// its test file's (test/<verb>_test.ts).

import { assert, assertEquals } from "@std/assert";
import { CONTRACT } from "../lib/answer.ts";
import { CAPABILITIES } from "../lib/capabilities.ts";
import { why } from "../lib/schema.ts";
import { HANDLERS } from "../main.ts";

const MAIN = new URL("../main.ts", import.meta.url).pathname;
const ROOT = "/work/project";

interface Called {
  exit: number;
  answer: Record<string, unknown> | undefined;
  stderr: string;
}

/** One call of main.ts, as fleet makes it: the file itself, executed. */
async function call(
  verb: string,
  stdin: string,
  env: Record<string, string> = {},
): Promise<Called> {
  const child = new Deno.Command(MAIN, {
    args: [verb],
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdin));
  await writer.close();
  const out = await child.output();
  const stdout = new TextDecoder().decode(out.stdout).trim();
  return {
    exit: out.code,
    answer: stdout === "" ? undefined : JSON.parse(stdout),
    stderr: new TextDecoder().decode(out.stderr).trim(),
  };
}

function request(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema_version: 1, root: ROOT, ...fields });
}

Deno.test("main.ts is executable, as fleet pack check demands of an entry", async () => {
  const mode = (await Deno.stat(MAIN)).mode ?? 0;
  assert((mode & 0o111) !== 0, `main.ts has mode ${mode.toString(8)}`);
});

Deno.test("capabilities answers the declaration in the envelope, exit 0", async () => {
  const called = await call("capabilities", request());
  assertEquals(called.exit, 0, called.stderr);
  assertEquals(called.answer, { schema_version: 1, ...CAPABILITIES });
  assertEquals(
    why(CONTRACT, CONTRACT.verbs.capabilities.response, called.answer),
    null,
  );
});

Deno.test("an unknown verb and another schema_version are usage, exit 2", async () => {
  const unknown = await call("frobnicate", request());
  assertEquals([unknown.exit, unknown.answer], [2, undefined]);
  assert(
    unknown.stderr.endsWith(
      "`frobnicate` is not a verb of the agent contract — the verbs are capabilities, context, launch, read, resume, version",
    ),
    unknown.stderr,
  );
  const later = await call(
    "capabilities",
    JSON.stringify({ schema_version: 2, root: ROOT }),
  );
  assertEquals([later.exit, later.answer], [2, undefined]);
  assert(later.stderr.endsWith("$.schema_version is 2, and it is 1"));
});

/**
 * The grant names FLEET_CLAUDE_BIN's absolute value in place of `claude`,
 * which a fixed shebang could not: a seam naming a path runs under a grant
 * for that path alone.
 */
Deno.test("the first two lines hand Deno the grant, the seam's path included", async () => {
  const [shebang, grant] = (await Deno.readTextFile(MAIN)).split("\n");
  assertEquals(shebang, "#!/bin/sh");
  assert(grant.startsWith("//usr/bin/env true; "), grant);
  for (
    const flag of [
      "--no-config",
      "--no-prompt",
      "--quiet",
      '--allow-run="$run"',
      "--allow-read",
      "--allow-write",
      "--allow-env=HOME,CLAUDE_CONFIG_DIR,FLEET_CLAUDE_BIN",
    ]
  ) {
    assert(grant.includes(` ${flag} `), `${flag} in ${grant}`);
  }
  const seamed = await call("capabilities", request(), {
    FLEET_CLAUDE_BIN: "/nowhere/claude",
  });
  assertEquals(seamed.exit, 0, seamed.stderr);
});

/** Every verb of the contract has its handler: nothing is left unfilled. */
Deno.test("HANDLERS answers every verb the contract names", () => {
  assertEquals(
    Object.keys(HANDLERS).sort(),
    Object.keys(CONTRACT.verbs).sort(),
  );
});
