// The tiny pack as it ships, checked against the fleet FLEET_BIN names: it
// names only verbs that binary has, it checks clean with every slot it fills,
// it lays over that binary's defaults and installs with ts, and its doctor
// entries and rituals are what they say they are.
//
// Each sweep carries the control that makes its zero a reading, and the scan
// set is the pack's DIRECTORY, so a document added later is read without
// anyone adding it here.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  binDir,
  families,
  files,
  fleet,
  git,
  invokedVerbs,
  machine,
  OS_LITTER,
  root,
  run,
  scratch,
} from "./fleet.ts";

const tiny = `${root}/tiny`;
const ts = `${root}/runtimes/ts`;

/** Every file under the pack, with its path relative to the pack. */
async function packFiles(): Promise<[string, string][]> {
  const found = await files(tiny);
  assert(found.length >= 4, `the pack was walked: ${found.map(([p]) => p)}`);
  return found;
}

// ---- the verbs --------------------------------------------------------------

Deno.test("every verb the pack invokes is one this binary has", async () => {
  const known = await families();
  assert(known.includes("pack"), `the families were read: ${known}`);

  // The control: a verb nobody implemented, through the same extractor and
  // the same membership test the sweep below uses.
  const madeUp = invokedVerbs("run `fleet frobnicate` afterwards");
  assertEquals(madeUp, ["frobnicate"]);
  assert(!known.includes(madeUp[0]), "and the membership test rejects it");

  let seen = 0;
  for (const [path, text] of await packFiles()) {
    for (const verb of invokedVerbs(text)) {
      seen += 1;
      assert(
        known.includes(verb),
        `${path} invokes \`fleet ${verb}\`, which this binary does not have: ${known}`,
      );
    }
  }
  assert(seen > 0, "the pack invokes verbs at all");
});

Deno.test("the pack teaches the delivery file and never the note flag", async () => {
  const all = await packFiles();
  const prompt = all.find(([p]) => p === "agents/builder/prompt.template.md");
  assert(prompt, "the pack ships the builder's prompt");
  for (
    const wanted of [
      "`fleet deliver --delivery <file>`",
      "`spec_corrections`",
      "`decisions`",
      "`not_proven`",
    ]
  ) {
    assert(
      prompt[1].includes(wanted),
      `the builder's prompt teaches ${wanted}`,
    );
  }
  for (const [path, text] of all) {
    assert(
      !text.includes("deliver --note"),
      `${path} hands a seat \`fleet deliver --note\`, which is gone`,
    );
  }
});

Deno.test("the pack teaches the question file and never the note flag", async () => {
  const all = await packFiles();
  const prompt = all.find(([p]) => p === "agents/builder/prompt.template.md");
  assert(prompt, "the pack ships the builder's prompt");
  for (
    const wanted of [
      "`fleet hold --question <file>`",
      "`question`",
      "`context`",
      "`options`",
      "`letter`",
    ]
  ) {
    assert(
      prompt[1].includes(wanted),
      `the builder's prompt teaches ${wanted}`,
    );
  }
  for (const [path, text] of all) {
    const flat = text.split(/\s+/).join(" ");
    assert(
      !flat.includes("hold --note"),
      `${path} hands a seat \`fleet hold --note\`, which is gone`,
    );
    assert(
      !text.includes("`QUESTION`"),
      `${path} teaches the \`QUESTION\` marker, and a question is JSON`,
    );
  }
});

Deno.test("no pack text teaches a prose record", async () => {
  const FORBIDDEN = [
    "On flight",
    "LEFT FLIGHT",
    "PARKED region",
    "delivery note",
    "QUESTION` at column zero",
    "an orders key",
  ];
  const found = (line: string) => FORBIDDEN.find((p) => line.includes(p));
  // The control: a line carrying one phrase is found by the same scan, and a
  // line carrying none is not.
  assertEquals(
    found("an `On flight` note with no `LEFT FLIGHT` after it"),
    "On flight",
  );
  assertEquals(found("the delivered entry, the diff at its commit"), undefined);

  let lines = 0;
  const taught: string[] = [];
  for (const [path, text] of await packFiles()) {
    text.split("\n").forEach((line, n) => {
      lines += 1;
      const phrase = found(line);
      if (phrase) taught.push(`${path}:${n + 1} \`${phrase}\`: ${line}`);
    });
  }
  assert(lines > 0, "the pack's documents were read line by line");
  assertEquals(taught, [], "these lines teach a prose record");
});

// ---- the slots the pack fills -----------------------------------------------

/** `fleet pack check` over `dir`: exit 0, and one line per slot the pack
 * fills with the entry count it fills it with. */
async function checksCleanWithEverySlot(dir: string): Promise<string> {
  const out = await run(fleet, ["pack", "check", dir]);
  assertEquals(
    out.code,
    0,
    `the pack checks clean — ${out.stdout}${out.stderr}`,
  );
  for (
    const line of [
      "pack tiny 0.1.0 — schema 3",
      "slot overlay: 1 entry",
      "slot doctor: 3 entries",
      "slot agents: 2 entries",
      "slot assets: 3 entries",
      "slot workflows: 1 entry",
      `slot skills: ${RITUALS.length} entries`,
    ]
  ) {
    assert(
      out.stdout.includes(line),
      `the report names ${line} — ${out.stdout}`,
    );
  }
  assert(
    !out.stdout.includes("runtime"),
    `the pack pins no runtime; ts does — ${out.stdout}`,
  );
  return out.stdout;
}

Deno.test("the pack checks clean with every slot it fills", async () => {
  await checksCleanWithEverySlot(tiny);
});

Deno.test("the pack checks clean over ts, the one pack it imports", async () => {
  const manifest = await Deno.readTextFile(`${tiny}/pack.toml`);
  assertEquals(
    [...manifest.matchAll(/^\[imports\.([a-z0-9-]+)\]/gm)].map((m) => m[1]),
    ["ts"],
    "tiny imports the runtime pack and nothing else",
  );
  assert(
    manifest.includes('source = "../runtimes/ts"'),
    "the import names ts where this repository keeps it",
  );

  const out = await run(fleet, ["pack", "check", tiny, "--over", ts]);
  assertEquals(out.code, 0, `${out.stdout}${out.stderr}`);
  assert(out.stdout.includes("resolved"), out.stdout);
});

Deno.test("the pack declares the two takeoff settings, each with one line a person reads", async () => {
  const manifest = await Deno.readTextFile(`${tiny}/pack.toml`);
  const settings = [...manifest.matchAll(/^\[config\."([^"]+)"\]\n([^[]*)/gm)];
  assertEquals(settings.map((m) => m[1]), ["takeoff.test", "takeoff.touched"]);
  for (const [, key, body] of settings) {
    const description = /^description = "([^"\n]+)"$/m.exec(body);
    assert(
      description && description[1].trim(),
      `${key} carries a description`,
    );
    assert(/^type = "string"$/m.test(body), `${key} is a command`);
  }
});

Deno.test("the pack checks clean and reads the same with OS litter in it", async () => {
  const dir = await scratch("litter");
  const copy = `${dir}/tiny`;
  await run("cp", ["-R", tiny, copy]);
  for (const sub of ["", "skills/", "skills/wake/", "assets/", "doctor/"]) {
    for (const name of OS_LITTER) {
      await Deno.writeFile(
        `${copy}/${sub}${name}`,
        new Uint8Array([
          0,
          0,
          0,
          1,
          0x42,
          0x75,
          0x64,
          0x31,
          0,
          0,
          0x10,
          0,
          0xff,
          0xfe,
        ]),
      );
    }
  }
  assert((await Deno.stat(`${copy}/skills/.DS_Store`)).isFile);

  await checksCleanWithEverySlot(copy);
  assertEquals(
    (await files(copy)).map(([p]) => p),
    (await packFiles()).map(([p]) => p),
    "the littered copy holds the pack's documents and nothing more",
  );
  await Deno.remove(dir, { recursive: true });
});

// ---- over the binary's defaults ---------------------------------------------

/** The Bash entry's command list out of a hooks document. */
async function preToolCommands(path: string): Promise<string[]> {
  const doc = JSON.parse(await Deno.readTextFile(path));
  const pre = doc.hooks.PreToolUse;
  assertEquals(pre.length, 1, `${path}: one entry, matching Bash`);
  assertEquals(pre[0].matcher, "Bash", path);
  return pre[0].hooks.map((h: { type: string; command: string }) => {
    assertEquals(h.type, "command", path);
    return h.command;
  });
}

Deno.test("the pack shadows four of the binary's defaults, and each shadow keeps what it shadows", async () => {
  const dir = await scratch("defaults");
  const { machine: at } = await machine(dir);
  const defaults = `${at}/defaults`;

  // Every file the pack carries at a path the defaults also carry is a
  // shadow, and these are the ones the pack means.
  const bottom = new Set((await files(defaults)).map(([p]) => p));
  assert(bottom.has("assets/brief.md"), "the defaults were materialized");
  assertEquals(
    (await packFiles()).map(([p]) => p).filter((p) => bottom.has(p)),
    [
      "assets/rules.md",
      "doctor/guards-installed/doctor.toml",
      "doctor/guards-installed/run.sh",
      "overlay/per-provider/claude/hooks.json",
    ],
    "the rules file, and the three that wire and report on the two guard classes this pack adds",
  );

  // The cost of shadowing a file whole: the copy carries the original, byte
  // for byte, and adds its own section after it.
  const under = await Deno.readFile(`${defaults}/assets/rules.md`);
  const over = await Deno.readFile(`${tiny}/assets/rules.md`);
  assert(under.length > 0, "the default rules file was read");
  assert(over.length > under.length, "the shadow adds its own section");
  assertEquals(
    over.slice(0, under.length),
    under,
    "the pack's rules open with the defaults', byte for byte",
  );

  // The hook list: the defaults' classes first, in order, then this pack's
  // two, which the defaults do not wire.
  const base = await preToolCommands(
    `${defaults}/overlay/per-provider/claude/hooks.json`,
  );
  const mine = await preToolCommands(
    `${tiny}/overlay/per-provider/claude/hooks.json`,
  );
  assert(base.length > 0 && mine.length > base.length, `${base} / ${mine}`);
  assertEquals(
    mine.slice(0, base.length),
    base,
    "the defaults' list begins it",
  );
  for (const cls of ["release-ref", "production-write"]) {
    assert(
      mine.some((c) => c.endsWith(`guard ${cls}`)),
      `the pack wires ${cls}`,
    );
    assert(
      !base.some((c) => c.endsWith(`guard ${cls}`)),
      `the defaults do not`,
    );
  }
  await Deno.remove(dir, { recursive: true });
});

Deno.test("fleet pack add of tiny installs ts beside it, and prime prints tiny's rules", async () => {
  const dir = await scratch("install");
  const { project, env } = await machine(dir);

  // A repository holding this working tree's two packs at the paths this
  // repository keeps them, so what installs is what is here and not what
  // was last committed.
  const repo = `${dir}/repo`;
  await Deno.mkdir(`${repo}/runtimes`, { recursive: true });
  await run("cp", ["-R", tiny, `${repo}/tiny`]);
  await run("cp", ["-R", ts, `${repo}/runtimes/ts`]);
  await git(repo, ["init", "--quiet", "-b", "main"]);
  await git(repo, ["add", "--all"]);
  await git(repo, ["commit", "--quiet", "--no-gpg-sign", "-m", "the packs"]);

  const added = await run(fleet, [
    "pack",
    "add",
    `${repo}//tiny`,
    "--version",
    "main",
  ], { cwd: project, env });
  assertEquals(added.code, 0, added.stderr);
  assert(added.stdout.includes("added tiny main at"), added.stdout);
  assert(
    added.stdout.includes("added ts main at") &&
      added.stdout.includes("which tiny imports"),
    `ts comes in with tiny, out of the same clone: ${added.stdout}`,
  );
  assertEquals(added.stderr, "", "no import is left missing");

  const listed = await run(fleet, ["pack", "list"], { cwd: project, env });
  assertEquals(listed.code, 0, listed.stderr);
  assert(listed.stdout.includes(`${repo}//runtimes/ts`), listed.stdout);

  const primed = await run(fleet, ["prime"], { cwd: project, env });
  assertEquals(primed.code, 0, primed.stderr);
  const [first, , ...rest] = primed.stdout.split("\n");
  assert(first.includes("packs: tiny, ts"), first);
  assert(
    rest.join("\n").startsWith(
      await Deno.readTextFile(`${tiny}/assets/rules.md`),
    ),
    "tiny's rules follow line 2 byte for byte",
  );
  await Deno.remove(dir, { recursive: true });
});

// ---- the doctor entries -----------------------------------------------------

const TARGETS = '[project]\nitem_prefix = "acme"\n\n[guards.targets]\n' +
  'release_ref_glob = "refs/heads/*release/*"\n' +
  'prod_buckets = ["live.example.test"]\n' +
  'prod_projects = ["example-production"]\n' +
  'prod_apps = ["example-frontdoor"]\n' +
  'prod_make_goals = ["ship-it"]\n' +
  'prod_dagger_functions = ["deployExecute"]\n' +
  'prod_workflow_refs = ["pipeline.yml:backend/release/*"]\n';

Deno.test("guards-installed runs all four classes' check lines and exits with the first non-zero", async () => {
  const dir = await scratch("guards");
  const bin = await binDir(dir);
  const project = `${dir}/project`;
  await Deno.mkdir(`${project}/.fleet`, { recursive: true });
  await Deno.writeTextFile(
    `${project}/.fleet/project.toml`,
    '[project]\nitem_prefix = "acme"\n',
  );
  const env = {
    PATH: `${bin}:${Deno.env.get("PATH")}`,
    HOME: `${dir}/home`,
    FLEET_DIR: `${dir}/machine`,
  };
  const entry = `${tiny}/doctor/guards-installed/run.sh`;

  let out = await run("sh", [entry], { cwd: project, env });
  for (
    const line of [
      "shell-trap record-backtick",
      "record bare-id",
      "release-ref push-target",
      "production-write bucket",
      "production-write app",
    ]
  ) {
    assert(
      out.stdout.includes(line),
      `all four --check lines ran — ${out.stdout}`,
    );
  }
  assertEquals(out.code, 1, "the release-ref class's unconfigured target");

  await Deno.writeTextFile(`${project}/.fleet/project.toml`, TARGETS);
  out = await run("sh", [entry], { cwd: project, env });
  assertEquals(out.code, 0, `every target configured — ${out.stdout}`);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("verbs-on-path prints the copy it resolved and fails when nothing resolves", async () => {
  const dir = await scratch("verbs");
  const bin = await binDir(dir);
  const entry = `${tiny}/doctor/verbs-on-path/run.sh`;
  const version = (await run(fleet, ["--version"])).stdout.trim();
  assert(version, "the binary answers its version flag");

  let out = await run("sh", [entry], {
    cwd: dir,
    env: { PATH: `${bin}:${Deno.env.get("PATH")}` },
  });
  assertEquals(out.code, 0, out.stdout);
  assert(out.stdout.includes(`${bin}/fleet`), `names the copy — ${out.stdout}`);
  assert(out.stdout.includes(version), `and its version — ${out.stdout}`);

  // The control: the host's own fleet-holding directories left out, so the
  // difference between the two runs is the one variable on any box.
  const bare = (Deno.env.get("PATH") ?? "").split(":").filter((d) => {
    try {
      return !Deno.statSync(`${d}/fleet`).isFile;
    } catch {
      return true;
    }
  });
  out = await run("sh", [entry], { cwd: dir, env: { PATH: bare.join(":") } });
  assertEquals(out.code, 1, out.stdout);
  assert(out.stdout.includes("no fleet on PATH"), out.stdout);
  await Deno.remove(dir, { recursive: true });
});

/** The work graph, stubbed: `show <id> --json` answers closed for one id, open
 * for another, and refuses for a third. */
const STUB_STORE = `#!/bin/sh
case "$2" in
acme-c10s) printf '[{"id":"acme-c10s","status":"closed"}]\\n' ;;
acme-op3n) printf '[{"id":"acme-op3n","status":"open"}]\\n' ;;
*) exit 1 ;;
esac
`;

async function aProjectWithARemote(dir: string, branches: string[]) {
  await git(dir, [
    "init",
    "--quiet",
    "--bare",
    "--initial-branch=main",
    "remote.git",
  ]);
  const work = `${dir}/work`;
  await Deno.mkdir(`${work}/.fleet`, { recursive: true });
  await git(work, ["init", "--quiet", "--initial-branch=main"]);
  await Deno.writeTextFile(
    `${work}/.fleet/project.toml`,
    '[project]\nname = "a-project"\nitem_prefix = "acme"\n',
  );
  await Deno.writeTextFile(`${work}/a-file`, "one\n");
  await git(work, ["add", "a-file"]);
  await git(work, [
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    "the first commit",
  ]);
  await git(work, ["remote", "add", "origin", `${dir}/remote.git`]);
  await git(work, ["push", "--quiet", "origin", "main"]);
  for (const branch of branches) {
    await git(work, ["push", "--quiet", "origin", `main:refs/heads/${branch}`]);
  }
  return work;
}

Deno.test("stale-branches reports a closed item's branch and leaves the branch where it is", async () => {
  const entry = `${tiny}/doctor/stale-branches/run.sh`;
  const rig = async (label: string, branches: string[]) => {
    const dir = await scratch(label);
    await Deno.mkdir(`${dir}/store`);
    await Deno.writeTextFile(`${dir}/store/bd`, STUB_STORE, { mode: 0o755 });
    const work = await aProjectWithARemote(dir, branches);
    const path = `${dir}/store:${Deno.env.get("PATH")}`;
    return { dir, work, path };
  };

  // 0: a remote carrying nothing but the trunk.
  let r = await rig("stale-clean", []);
  let out = await run("sh", [entry], { cwd: r.work, env: { PATH: r.path } });
  assertEquals(out.code, 0, `${out.stdout}${out.stderr}`);
  await Deno.remove(r.dir, { recursive: true });

  // 1: one item closed and one open; the open one is the control.
  r = await rig("stale-one", ["ab/feat/acme-c10s", "ab/feat/acme-op3n"]);
  out = await run("sh", [entry], { cwd: r.work, env: { PATH: r.path } });
  assertEquals(out.code, 1, `${out.stdout}${out.stderr}`);
  assert(
    out.stdout.includes("ab/feat/acme-c10s") &&
      out.stdout.includes("--delete ab/feat/acme-c10s"),
    out.stdout,
  );
  assert(!out.stdout.includes("acme-op3n"), out.stdout);
  assertEquals(out.stdout.trim().split("\n").length, 1, "one line per finding");
  // IT PRINTS AND NEVER RUNS.
  assert(
    (await git(r.work, ["ls-remote", "--heads", "origin"])).includes(
      "refs/heads/ab/feat/acme-c10s",
    ),
  );
  await Deno.remove(r.dir, { recursive: true });

  // 3, twice: an item the store cannot answer for, and a remote not there.
  r = await rig("stale-unreadable", ["ab/feat/acme-zz9z"]);
  out = await run("sh", [entry], { cwd: r.work, env: { PATH: r.path } });
  assertEquals(out.code, 3, out.stderr);
  await git(r.work, [
    "remote",
    "set-url",
    "origin",
    "/no/such/remote/at/all.git",
  ]);
  out = await run("sh", [entry], { cwd: r.work, env: { PATH: r.path } });
  assertEquals(out.code, 3, out.stderr);
  await Deno.remove(r.dir, { recursive: true });
});

// ---- the ritual skills ------------------------------------------------------

/** The rituals the pack ships, each with the line budget its spec set, and
 * `null` where the spec set none. */
const RITUALS: [string, number | null][] = [
  ["wake", 150],
  ["handoff", 130],
  ["rest", 40],
  ["clock-out", 40],
  ["morning", 90],
  ["corrections-review", 90],
  ["praise", 50],
  ["report", null],
  ["runbook", null],
  ["preboard", null],
  ["takeoff", null],
  ["adopt", null],
];

async function packSkills(): Promise<[string, string][]> {
  const found = (await packFiles()).flatMap(([path, text]) => {
    const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(path);
    return m ? [[m[1], text] as [string, string]] : [];
  });
  assert(
    found.length > 0,
    "the pack's skills slot was walked and holds skills",
  );
  return found;
}

function frontmatter(text: string): string[] | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  return end < 0 ? null : text.slice(4, end).split("\n");
}

Deno.test("every ritual the pack names is a skill with frontmatter", async () => {
  const skills = await packSkills();
  const names = skills.map(([d]) => d);
  for (const [ritual] of RITUALS) {
    assert(names.includes(ritual), `the pack ships the \`${ritual}\` skill`);
  }
  // The control on the parser: frontmatter that is not there reads as absent.
  assertEquals(frontmatter("# no frontmatter here\n"), null);
  for (const [dir, text] of skills) {
    const front = frontmatter(text);
    assert(front, `${dir}/SKILL.md opens on its frontmatter block`);
    const field = (key: string) =>
      front.find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1).trim();
    assertEquals(
      field("name"),
      dir,
      `${dir}/SKILL.md names itself for its directory`,
    );
    assert(
      field("description"),
      `${dir}/SKILL.md's description says something`,
    );
  }
});

Deno.test("every verb a ritual invokes is one this binary has", async () => {
  const known = await families();
  const madeUp = invokedVerbs("then run `fleet frobnicate` and read the exit");
  assertEquals(madeUp, ["frobnicate"]);
  assert(!known.includes(madeUp[0]));
  let seen = 0;
  for (const [dir, text] of await packSkills()) {
    for (const verb of invokedVerbs(text)) {
      seen += 1;
      assert(
        known.includes(verb),
        `${dir}/SKILL.md invokes \`fleet ${verb}\`, which this binary does not have`,
      );
    }
  }
  assert(seen > 0, "the rituals invoke verbs at all");
});

Deno.test("every ritual is under the line budget its spec set", async () => {
  const skills = await packSkills();
  for (const [ritual, cap] of RITUALS) {
    if (cap === null) continue;
    const text = skills.find(([d]) => d === ritual)?.[1];
    assert(text !== undefined, `the pack ships the \`${ritual}\` skill`);
    const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    assert(lines <= cap, `${ritual}/SKILL.md is ${lines} lines, over ${cap}`);
  }
});
