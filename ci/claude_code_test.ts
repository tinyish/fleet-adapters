// The claude-code pack's hook, end to end, against the fleet FLEET_BIN names:
// the pack installed from this checkout into a scratch fleet, and a Claude
// Code PreToolUse payload for a command the shell-trap class refuses piped to
// `fleet guard --adapter claude-code`, the line the plugin's hooks.json runs.
// It must print the deny document fleet's built-in claude-code mapping prints
// today, byte for byte, with the reason filled — which holds the pack's
// [hook] table to the built-in manifest until fleet-x93d.2 deletes the
// built-in.
//
// HOW THE PACK IS PROVEN TO BE WHAT ANSWERED. By name, `--adapter
// claude-code` is looked up in the installed packs, and a built-in of the
// same name answers the same bytes; so the last arm changes the installed
// copy's deny template and the guard's answer must change with it.
//
// THE PAYLOAD IS NOT A RECORDING. It is Claude Code's PreToolUse input in the
// shape its hooks documentation gives (session_id, transcript_path, cwd,
// permission_mode, hook_event_name, tool_name, tool_input, tool_use_id), with
// made-up values; fleet reads tool_name, tool_input.command and cwd from it,
// by the pointers adapter.toml's [hook] declares. A payload recorded from a
// live 2.1.280 seat replaces it when one is recorded.
//
// THE LIVE ARM, run by ci/check-claude-code-live.sh with FLEET_LIVE=1 and
// ignored otherwise: in the same scratch fleet, `fleet doctor` reports the
// pack's claude-code-version and isolation-pair, and both hold. It starts no
// session, but runs the claude FLEET_CLAUDE_BIN names (else the one on PATH)
// and asks it for the operator's login.
//
// Needs deno and git on PATH; the hook arm runs no claude.

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { fleet, git, root, run, scratch } from "./fleet.ts";

const PACKS = ["adapters/agent/claude-code", "runtimes/ts"];
const INSTALLED_MANIFEST = "adapters/agent/claude-code/adapter.toml";

/** A PreToolUse payload for one Bash command, in Claude Code's shape. */
function payload(command: string, cwd: string): string {
  return JSON.stringify({
    session_id: "3f0c1a7e-5b2d-4c8e-9a61-2d7f4e8b9c10",
    transcript_path:
      `${cwd}/.config/projects/-work/3f0c1a7e-5b2d-4c8e-9a61-2d7f4e8b9c10.jsonl`,
    cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command, description: "Print each branch" },
    tool_use_id: "toolu_01A2B3C4D5E6F7G8H9J0K1L2",
  });
}

const TRAP = "for b in $BRANCHES; do echo $b; done";

interface Rig {
  dir: string;
  project: string;
  machine: string;
  env: Record<string, string>;
}

/** The two packs, copied into a repository of their own: what `fleet pack
 * add` fetches is this checkout's tree, committed or not. */
async function snapshot(dir: string): Promise<string> {
  const source = `${dir}/fleet-packs`;
  for (const pack of PACKS) {
    const into = `${source}/${pack}`;
    await Deno.mkdir(into.slice(0, into.lastIndexOf("/")), { recursive: true });
    const copied = await run("cp", ["-R", `${root}/${pack}`, into]);
    assertEquals(copied.code, 0, copied.stderr);
  }
  await git(source, ["init", "--quiet", "--initial-branch", "main"]);
  await git(source, ["add", "-A"]);
  await git(source, ["commit", "--quiet", "--no-gpg-sign", "-m", "the packs"]);
  return source;
}

/** A scratch fleet with the pack installed from this checkout. */
async function rig(): Promise<Rig> {
  const dir = await Deno.realPath(await scratch("claude-code-hook"));
  const project = `${dir}/project`;
  const machine = `${dir}/machine`;
  const home = `${dir}/home`;
  for (const made of [project, home]) {
    await Deno.mkdir(made, { recursive: true });
  }
  const env = { HOME: home, FLEET_HOME: home, FLEET_DIR: machine };
  await git(project, ["init", "--quiet", "--initial-branch", "main"]);

  const made = await run(fleet, [
    "create",
    "--embedded",
    "--agent",
    "claude_code",
    "--store",
    "none",
  ], { cwd: project, env });
  assertEquals(made.code, 0, `fleet create: ${made.stdout}${made.stderr}`);

  const source = await snapshot(dir);
  const added = await run(fleet, [
    "pack",
    "add",
    `${source}//adapters/agent/claude-code`,
    "--version",
    "main",
  ], { cwd: project, env });
  assertEquals(added.code, 0, `fleet pack add: ${added.stdout}${added.stderr}`);
  assert(added.stdout.includes("added claude-code main"), added.stdout);
  return { dir, project, machine, env };
}

/** `fleet guard <args>` in the project, `input` on its stdin. */
async function guard(at: Rig, args: string[], input: string) {
  const child = new Deno.Command(fleet, {
    args: ["guard", ...args],
    cwd: at.project,
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "", ...at.env },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input));
  await writer.close();
  const out = await child.output();
  const text = new TextDecoder();
  return {
    code: out.code,
    stdout: text.decode(out.stdout),
    stderr: text.decode(out.stderr),
  };
}

Deno.test({
  name:
    "fleet guard --adapter claude-code, through the installed pack, prints the built-in's deny",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const at = await rig();
    try {
      const trap = payload(TRAP, at.project);

      await t.step(
        "a command the shell-trap class refuses is denied, the reason filled",
        async () => {
          const pack = await guard(at, ["--adapter", "claude-code"], trap);
          assertEquals(pack.code, 0, pack.stderr);
          const document = JSON.parse(pack.stdout);
          assertEquals(Object.keys(document), ["hookSpecificOutput"]);
          const said = document.hookSpecificOutput;
          assertEquals(said.hookEventName, "PreToolUse");
          assertEquals(said.permissionDecision, "deny");
          assert(
            String(said.permissionDecisionReason).startsWith(
              "fleet guard shell-trap: UNSPLIT VARIABLE — $BRANCHES",
            ),
            said.permissionDecisionReason,
          );

          // The built-in mapping, named by no flag: the same class, the same
          // bytes.
          const builtIn = await guard(at, ["shell-trap"], trap);
          assertEquals(builtIn.code, 0, builtIn.stderr);
          assertEquals(pack.stdout, builtIn.stdout);
        },
      );

      await t.step("a command no class refuses prints nothing", async () => {
        const quiet = await guard(
          at,
          ["--adapter", "claude-code"],
          payload("git status", at.project),
        );
        assertEquals(quiet, { code: 0, stdout: "", stderr: "" });
      });

      await t.step(
        "the installed pack's [hook] is what answered",
        async () => {
          const manifest =
            `${at.machine}/packs/claude-code/${INSTALLED_MANIFEST}`;
          const before = await Deno.readTextFile(manifest);
          const marked = before.replace(
            '"permissionDecision":"deny"',
            '"permissionDecision":"deny","marked":true',
          );
          assertNotEquals(marked, before, "the deny template was not found");
          await Deno.writeTextFile(manifest, marked);
          const pack = await guard(at, ["--adapter", "claude-code"], trap);
          assertEquals(pack.code, 0, pack.stderr);
          assertEquals(
            JSON.parse(pack.stdout).hookSpecificOutput.marked,
            true,
            pack.stdout,
          );
        },
      );
    } finally {
      await Deno.remove(at.dir, { recursive: true });
    }
  },
});

/** The variables of the caller's a live doctor check reads: the claude to
 * run, and the login it asks for, which is the operator's. */
const LIVE_ENV = [
  "HOME",
  "USER",
  "FLEET_CLAUDE_BIN",
  "CLAUDE_CONFIG_DIR",
  "TMPDIR",
];

Deno.test({
  name:
    "live: fleet doctor reports claude-code-version and isolation-pair from the pack, both holding",
  ignore: Deno.env.get("FLEET_LIVE") !== "1",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const at = await rig();
    try {
      const env: Record<string, string> = {
        ...at.env,
        DISABLE_AUTOUPDATER: "1",
      };
      for (const name of LIVE_ENV) {
        const value = Deno.env.get(name);
        if (value !== undefined) env[name] = value;
      }
      const out = await run(fleet, [
        "doctor",
        "claude-code-version",
        "isolation-pair",
        "--json",
      ], { cwd: at.project, env });
      console.log(out.stdout);
      console.error(out.stderr);
      const rows: Record<string, unknown>[] = JSON.parse(out.stdout).data
        .checks;
      assertEquals(
        rows.map((row) => [row.name, row.layer, row.verdict]),
        [
          ["claude-code-version", "claude-code", "pass"],
          ["isolation-pair", "claude-code", "pass"],
        ],
        JSON.stringify(rows),
      );
      assertEquals(out.code, 0, out.stderr);
    } finally {
      await Deno.remove(at.dir, { recursive: true });
    }
  },
});
