// plugin/: fleet's Claude Code plugin, which launch and resume hand every
// seat with --plugin-dir — the manifest, the one hooks file, the shim and the
// skills — and the marketplace at the repository's root that lists it for a
// person's own session. Restated from tinyfleet's cli/tests/plugin.rs (at
// dbc7908), whose root plugin this one replaces.
//
// Every shim arm runs the shim itself, the way Claude Code runs a hook:
// through /bin/sh, with CLAUDE_PLUGIN_ROOT naming the root and nothing
// inherited — this process's own FLEET_BIN least of all, since a suite run
// inside a seat carries one. Where FLEET_BIN names a fleet, the hook line is
// also run over that binary against a scratch machine directory.

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { parse } from "@std/toml";
import { pluginDir } from "../lib/plugin.ts";
import { PLUGIN_OWN_SKILLS, pluginSkills, tinySkills } from "../lib/skills.ts";

const PLUGIN = pluginDir();
const ADAPTER = decodeURIComponent(new URL("..", import.meta.url).pathname)
  .replace(/\/$/, "");
const REPO = decodeURIComponent(
  new URL("../../../../../../..", import.meta.url).pathname,
).replace(/\/$/, "");
const SHIM = `${PLUGIN}/bin/fleet`;
const FLEET = Deno.env.get("FLEET_BIN");

/** The address a hook has and the Bash tool's PATH does not (lessons D5). */
const ROOT_PREFIX = '"${CLAUDE_PLUGIN_ROOT}"/bin/';

type Json = Record<string, unknown>;

async function json(path: string): Promise<Json> {
  return JSON.parse(await Deno.readTextFile(path));
}

async function packVersion(): Promise<string> {
  const manifest = parse(
    await Deno.readTextFile(`${ADAPTER}/../../../pack.toml`),
  ) as { pack: { version: string } };
  return manifest.pack.version;
}

/** The commands of one hooks entry, each asserted a command hook. */
function commands(entry: Json): string[] {
  const hooks = entry.hooks as Json[];
  return hooks.map((hook) => {
    assertEquals(hook.type, "command");
    return hook.command as string;
  });
}

async function hooks(): Promise<Json> {
  return (await json(`${PLUGIN}/hooks/hooks.json`)).hooks as Json;
}

Deno.test("the manifest names fleet at the pack's version, with a description and an author", async () => {
  const manifest = await json(`${PLUGIN}/.claude-plugin/plugin.json`);
  assertEquals(manifest.name, "fleet");
  assertEquals(manifest.version, await packVersion());
  assert(String(manifest.description ?? "").trim() !== "");
  assert(String((manifest.author as Json)?.name ?? "").trim() !== "");
});

Deno.test("the repository's marketplace lists one plugin, fleet, at this plugin", async () => {
  const market = await json(`${REPO}/.claude-plugin/marketplace.json`);
  assertEquals(market.name, "fleet");
  assert(String((market.owner as Json)?.name ?? "").trim() !== "");
  assert(String(market.description ?? "").trim() !== "");
  const plugins = market.plugins as Json[];
  assertEquals(plugins.length, 1);
  assertEquals(plugins[0].name, "fleet");
  const source = plugins[0].source as string;
  assert(source.startsWith("./"), source);
  assertEquals(await Deno.realPath(`${REPO}/${source}`), PLUGIN);
});

/**
 * One PreToolUse entry on Bash with ONE command, the guard over the classes
 * the layers declare (fleet-14p8.9), and one SessionStart line, prime: both
 * addressed through the plugin root, and no other event.
 */
Deno.test("hooks.json holds one guard line and the prime line, both root-prefixed", async () => {
  const wired = await hooks();
  assertEquals(Object.keys(wired).sort(), ["PreToolUse", "SessionStart"]);
  const pre = wired.PreToolUse as Json[];
  assertEquals(pre.length, 1);
  assertEquals(pre[0].matcher, "Bash");
  assertEquals(commands(pre[0]), [
    `${ROOT_PREFIX}fleet guard --adapter claude-code`,
  ]);
  const start = wired.SessionStart as Json[];
  assertEquals(start.length, 1);
  assertEquals(commands(start[0]), [`${ROOT_PREFIX}fleet prime`]);
});

async function guardLine(): Promise<string> {
  return commands(((await hooks()).PreToolUse as Json[])[0])[0];
}

async function primeLine(): Promise<string> {
  return commands(((await hooks()).SessionStart as Json[])[0])[0];
}

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * `line` run as Claude Code runs a hook: /bin/sh -c, CLAUDE_PLUGIN_ROOT set,
 * a bare PATH, and `env` — nothing else inherited — with a pre-tool payload
 * on stdin.
 */
async function sh(
  line: string,
  env: Record<string, string> = {},
  command = "git status",
): Promise<Ran> {
  const child = new Deno.Command("/bin/sh", {
    args: ["-c", line],
    clearEnv: true,
    env: { PATH: "/usr/bin:/bin", CLAUDE_PLUGIN_ROOT: PLUGIN, ...env },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: "/",
    })),
  ).catch(() => undefined);
  await writer.close().catch(() => undefined);
  const out = await child.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

Deno.test("the shim is executable", async () => {
  const mode = (await Deno.stat(SHIM)).mode!;
  assert((mode & 0o111) !== 0, mode.toString(8));
});

/** An absolute FLEET_BIN is run with the arguments exactly as given. */
Deno.test("the shim runs the absolute FLEET_BIN with every argument as given", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const stub = `${dir}/fleet`;
    await Deno.writeTextFile(
      stub,
      '#!/bin/sh\nfor a in "$@"; do printf "[%s]" "$a"; done\nexit 7\n',
    );
    await Deno.chmod(stub, 0o755);
    const ran = await sh(`'${SHIM}' guard --adapter claude-code 'a b'`, {
      FLEET_BIN: stub,
    });
    assertEquals(ran.code, 7, ran.stderr);
    assertEquals(ran.stdout, "[guard][--adapter][claude-code][a b]");
    assertEquals(ran.stderr, "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: "the shim's answer is FLEET_BIN's own",
  ignore: FLEET === undefined || FLEET === "",
  fn: async () => {
    const direct = await new Deno.Command(FLEET!, { args: ["--version"] })
      .output();
    const through = await sh(`'${SHIM}' --version`, { FLEET_BIN: FLEET! });
    assertEquals(through.code, 0, through.stderr);
    assertEquals(through.stdout, new TextDecoder().decode(direct.stdout));
  },
});

/**
 * THE SHIM NEVER SEARCHES (fleet-78r, ruled 2026-09-26: FLEET_BIN is the one
 * source). A `fleet` first on PATH and a built one under the plugin's own
 * target/ are both there, and neither runs.
 */
Deno.test("with no FLEET_BIN the shim runs no fleet it could find", async () => {
  const dir = await Deno.makeTempDir();
  const target = `${PLUGIN}/target/release`;
  try {
    const decoy = '#!/bin/sh\necho "ran a decoy"\nexit 0\n';
    await Deno.writeTextFile(`${dir}/fleet`, decoy);
    await Deno.chmod(`${dir}/fleet`, 0o755);
    await Deno.mkdir(target, { recursive: true });
    await Deno.writeTextFile(`${target}/fleet`, decoy);
    await Deno.chmod(`${target}/fleet`, 0o755);
    const ran = await sh(`'${SHIM}' --version`, {
      PATH: `${dir}:/usr/bin:/bin`,
    });
    assertEquals(ran.code, 127, ran.stderr);
    assertEquals(ran.stdout, "");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(`${PLUGIN}/target`, { recursive: true });
  }
});

/**
 * The ways a binary is missing — none named, a relative FLEET_BIN, and one
 * naming nothing or no file — each answered by who is asking.
 */
const MISSING: [string, Record<string, string>, string][] = [
  ["no FLEET_BIN", {}, "FLEET_BIN is not set"],
  ["a relative FLEET_BIN", {
    FLEET_BIN: "target/debug/fleet",
  }, "`target/debug/fleet`, which is not an absolute path"],
  ["a FLEET_BIN naming nothing", {
    FLEET_BIN: "/nonexistent/fleet",
  }, "`/nonexistent/fleet`, which is not an executable file"],
  ["a FLEET_BIN naming a directory", {
    FLEET_BIN: "/usr",
  }, "`/usr`, which is not an executable file"],
];

/**
 * THE GUARD FAILS CLOSED: exit 2, the one status a pre-tool hook blocks on,
 * nothing on stdout, and the reason — which Claude Code hands the session
 * with the block — naming the hook, what is missing and how to supply it.
 */
Deno.test("the guard line with no binary to run blocks the call and says how to supply one", async () => {
  const line = await guardLine();
  for (const [shape, env, named] of MISSING) {
    const ran = await sh(line, env);
    assertEquals(ran.code, 2, `${shape}: ${ran.stderr}`);
    assertEquals(ran.stdout, "", shape);
    for (
      const owed of [
        "blocked",
        "`fleet guard --adapter claude-code`",
        named,
        "FLEET_BIN",
        "absolute path",
      ]
    ) {
      assertStringIncludes(ran.stderr, owed, shape);
    }
    assert(!ran.stderr.includes("cargo"), `${shape}: ${ran.stderr}`);
  }
});

/** THE SESSION-START LINE FAILS OPEN: 127, which never blocks, and says so. */
Deno.test("the prime line with no binary exits 127 and says what the session lacks", async () => {
  const line = await primeLine();
  for (const [shape, env, named] of MISSING) {
    const ran = await sh(line, env);
    assertEquals(ran.code, 127, `${shape}: ${ran.stderr}`);
    assertEquals(ran.stdout, "", shape);
    for (
      const owed of [
        "this session starts without",
        "every Bash command",
        "blocked",
        named,
        "FLEET_BIN",
        "absolute path",
      ]
    ) {
      assertStringIncludes(ran.stderr, owed, shape);
    }
  }
});

/**
 * Any other verb, `guard --check` among them, is a command that could not
 * run: 127, and no word of a block — the Bash tool reaches this file by name.
 */
Deno.test("any other verb with no binary exits 127 and never speaks of a block", async () => {
  for (
    const verb of ["status", "guard shell-trap --check", "guard --check"]
  ) {
    for (const [shape, env, named] of MISSING) {
      const ran = await sh(`'${SHIM}' ${verb}`, env);
      assertEquals(ran.code, 127, `${verb}, ${shape}: ${ran.stderr}`);
      assertEquals(ran.stdout, "");
      assert(!ran.stderr.includes("blocked"), `${verb}: ${ran.stderr}`);
      assertStringIncludes(ran.stderr, named);
      assertStringIncludes(ran.stderr, "absolute path");
    }
  }
});

/**
 * The guard line over a real fleet: a machine whose layers resolve judges
 * the call (the shell trap refuses in Claude Code's PreToolUse deny, a plain
 * command runs), and one whose layers do not resolve exits 2 — fail closed,
 * fleet-14p8.4 — never letting the call through unjudged.
 */
Deno.test({
  name:
    "the guard line over FLEET_BIN judges, and fails closed where the layers do not resolve",
  ignore: FLEET === undefined || FLEET === "",
  fn: async () => {
    const line = await guardLine();
    const machine = await Deno.makeTempDir();
    const bare = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${machine}/defaults`);
      const env = { FLEET_BIN: FLEET!, FLEET_DIR: machine, HOME: machine };
      const refused = await sh(line, env, "for b in $BRANCHES; do :; done");
      assertEquals(refused.code, 0, refused.stderr);
      const deny = JSON.parse(refused.stdout).hookSpecificOutput;
      assertEquals(deny.hookEventName, "PreToolUse");
      assertEquals(deny.permissionDecision, "deny");
      assertMatch(deny.permissionDecisionReason, /^fleet guard shell-trap: /);
      const allowed = await sh(line, env, "git status");
      assertEquals(allowed, { code: 0, stdout: "", stderr: "" });
      const closed = await sh(line, { ...env, FLEET_DIR: bare });
      assertEquals(closed.code, 2, closed.stderr);
      assertEquals(closed.stdout, "");
      assertStringIncludes(closed.stderr, "do not resolve");
    } finally {
      await Deno.remove(machine, { recursive: true });
      await Deno.remove(bare, { recursive: true });
    }
  },
});

async function names(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) found.push(entry.name);
  return found.sort();
}

/** Every file under `dir`, relative, with its bytes; a link is refused. */
async function files(dir: string, at = ""): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  for await (const entry of Deno.readDir(`${dir}${at}`)) {
    const path = `${at}/${entry.name}`;
    assert(!entry.isSymlink, `${dir}${path} is a link`);
    if (entry.isDirectory) {
      for (const [k, v] of await files(dir, path)) seen.set(k, v);
    } else seen.set(path, await Deno.readTextFile(`${dir}${path}`));
  }
  return seen;
}

/**
 * The plugin's own probe, and every tiny skill as a REAL DIRECTORY holding
 * tiny's files byte for byte (scripts/skills.ts says why copies): a skill
 * added to tiny, changed there, or left behind here reds this.
 */
Deno.test("every tiny skill is in the plugin, a copy byte for byte, beside the probe", async () => {
  const tiny = await names(tinySkills());
  assertEquals(tiny.length, 12, tiny.join(" "));
  assertEquals(
    await names(pluginSkills()),
    [...tiny, ...PLUGIN_OWN_SKILLS].sort(),
  );
  for (const name of tiny) {
    const ours = await files(`${pluginSkills()}/${name}`);
    assert(ours.has("/SKILL.md"), name);
    assertEquals(ours, await files(`${tinySkills()}/${name}`), name);
  }
  assert((await Deno.lstat(`${pluginSkills()}/wake`)).isDirectory);
});

Deno.test("the probe skill is named version and is the plugin's own", async () => {
  const path = `${pluginSkills()}/version/SKILL.md`;
  assert((await Deno.lstat(`${pluginSkills()}/version`)).isDirectory);
  const skill = await Deno.readTextFile(path);
  assert(skill.startsWith("---\n"));
  const front = skill.split("\n---")[0].split("\n").map((l) => l.trim());
  assert(front.includes("name: version"), front.join("\n"));
  assert(front.some((l) => l.startsWith("description:")));
  assertStringIncludes(skill, "fleet --version");
});

/** Nothing in the plugin is a link: the plugin is what a copy carries. */
Deno.test("the plugin carries no link anywhere", async () => {
  const all = await files(PLUGIN);
  assert(all.has("/bin/fleet") && all.has("/hooks/hooks.json"));
});
