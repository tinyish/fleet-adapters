// adapter.toml's [hook]: Claude Code's pre-tool payload and refusal, as
// `fleet guard --adapter` reads them.
//
// THE TABLE is held here to the values of fleet's built-in manifest
// (controller/src/adapter/claude_code.hook.toml at tinyfleet 451a33d). WHERE
// FLEET_BIN NAMES A FLEET, the guard itself is run on sample payloads with
// this adapter's directory and with no flag, and the two refusals must be
// the same bytes; without one that arm is ignored.

import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";

const DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const MANIFEST = parse(await Deno.readTextFile(`${DIR}/adapter.toml`)) as {
  adapter: Record<string, string>;
  hook: Record<string, string>;
};

Deno.test("adapter.toml declares the agent adapter and its entry", () => {
  assertEquals(MANIFEST.adapter.name, "claude-code");
  assertEquals(MANIFEST.adapter.kind, "agent");
  assertEquals(MANIFEST.adapter.entry, "main.ts");
  assertEquals(
    Object.keys(MANIFEST.adapter).sort(),
    ["description", "entry", "kind", "name", "version"],
  );
});

Deno.test("[hook] is the built-in's mapping, value for value, with no paths pointer", () => {
  assertEquals(MANIFEST.hook, {
    shell_tool: "Bash",
    tool: "/tool_name",
    command: "/tool_input/command",
    cwd: "/cwd",
    deny:
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":{reason}}}',
  });
});

/** {reason} filled as a JSON string is the PreToolUse deny Claude Code reads. */
Deno.test("[hook] deny, filled, is Claude Code's PreToolUse deny", () => {
  const reason = 'a "quoted" \\ reason — ñ';
  const filled = MANIFEST.hook.deny.replace(
    "{reason}",
    JSON.stringify(reason),
  );
  assertEquals(JSON.parse(filled), {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
});

const FLEET = Deno.env.get("FLEET_BIN");

async function guard(args: string[], payload: string, fleetDir: string) {
  const child = new Deno.Command(FLEET!, {
    args: ["guard", ...args],
    env: { FLEET_DIR: fleetDir },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(payload));
  await writer.close();
  const out = await child.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

/**
 * docs/guards.md's example, and refusals carrying quotes, backslashes and
 * non-ASCII text, through all four classes; and a payload naming another
 * tool, which neither judges.
 */
Deno.test({
  name: "fleet guard --adapter <this dir> refuses in the built-in's bytes",
  ignore: FLEET === undefined || FLEET === "",
  fn: async () => {
    const fleetDir = await Deno.makeTempDir();
    try {
      const bash = (command: string) =>
        JSON.stringify({
          tool_name: "Bash",
          tool_input: { command },
          cwd: ".",
        });
      const cases: [string, string, boolean][] = [
        ["shell-trap", bash("for b in $BRANCHES; do echo $b; done"), true],
        ["shell-trap", bash('for f in $FILES; do echo "ñ \\ $f"; done'), true],
        ["record", bash("bd update fx-1 --status closed"), false],
        ["release-ref", bash("git push origin HEAD:main"), false],
        ["production-write", bash("echo hi"), false],
        [
          "shell-trap",
          JSON.stringify({
            tool_name: "Edit",
            tool_input: { command: "for b in $X; do :; done" },
          }),
          false,
        ],
      ];
      let refused = 0;
      for (const [cls, payload, mustRefuse] of cases) {
        const builtIn = await guard([cls], payload, fleetDir);
        const pack = await guard([cls, "--adapter", DIR], payload, fleetDir);
        assertEquals(pack, builtIn, `${cls} ${payload}`);
        assertEquals(pack.code, 0, pack.stderr);
        if (pack.stdout !== "") refused++;
        if (mustRefuse) assert(pack.stdout !== "", `${cls} ${payload}`);
      }
      assert(refused >= 2);
    } finally {
      await Deno.remove(fleetDir, { recursive: true });
    }
  },
});
