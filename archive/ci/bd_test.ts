// The bd pack on a real board, against the fleet FLEET_BIN names: installed
// from this checkout into a scratch machine, named as the project's store,
// and driven through the verbs whose writes are fenced — so each fenced write
// is proven by fleet itself, opening the store through the pack's main.ts,
// and read back through `fleet item show --json`.
//
// WHAT STANDS IN, AND WHY. No agent runs here and no service is loaded: the
// agent binary (FLEET_CLAUDE_BIN) is a stub whose roster is always empty and
// whose background start exits 0, and the service manager (FLEET_SERVICE_BIN)
// is a stub that answers `fleet start` the way tinyfleet's own cli suites
// stub it. So a dispatch orders and rings nobody (exit 4, "ORDERED, NOT
// RUNG"), a spawned seat is a worktree and a row with no session, and its
// retire finds no live session to stop. Every store write is real.
//
// HOW THE PACK IS PROVEN TO BE THE STORE. `[store] adapter = "bd"` opens
// fleet's built-in bd, because that is the built-in's name and fleet checks
// it before it looks for a pack (core/src/store/mod.rs, `open`, at the pinned
// commit) — the first arm below shows it. So the project names the installed
// main.ts by its absolute path, and `deno` on the PATH fleet runs under is a
// wrapper that logs each call before it execs the real one: the built-in
// store never runs deno, so a logged `main.ts <verb>` is a call the pack
// answered.
//
// Needs deno, bd and git on PATH.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { fleet, git, root, run, scratch } from "./fleet.ts";
import { PINNED } from "../adapters/store/bd/adapters/store/bd/lib/bd.ts";

/** The delivery a seat hands in, in the shape `fleet deliver` reads. */
const DELIVERY = {
  files: ["the-work.txt"],
  checks: [{ check: "the ring", result: "each rc read from its own command" }],
  suite: { command: "ci/bd_test.ts", rc: 0 },
  spec_corrections: [],
  not_proven: [{
    surface: "a live agent session",
    command: "none: the smoke ring runs no agent",
  }],
  decisions: [],
  covers: [],
};

/**
 * The findings the SDK's takeoff writes on a returned review
 * (runtimes/ts/assets/sdk/testdata), handed to `fleet review --return` here —
 * which ties the SDK's findings to the shape the pinned fleet reads.
 */
const FINDINGS =
  `${root}/runtimes/ts/assets/sdk/testdata/takeoff_findings_b.json`;

interface Rig {
  dir: string;
  project: string;
  machine: string;
  env: Record<string, string>;
  /** The log the deno wrapper appends one line to per call. */
  log: string;
  /** The installed adapter's entry. */
  main: string;
}

async function executable(path: string, text: string) {
  await Deno.writeTextFile(path, text);
  await Deno.chmod(path, 0o755);
}

/** A scratch machine, project and stubs, and the env every fleet call gets. */
async function rig(): Promise<Rig> {
  const dir = await Deno.realPath(await scratch("bd-ring"));
  const project = `${dir}/project`;
  const machine = `${dir}/machine`;
  const home = `${dir}/home`;
  const stubs = `${dir}/stubs`;
  const wrap = `${dir}/wrap`;
  const log = `${dir}/deno-calls`;
  for (const made of [project, home, stubs, wrap, `${dir}/no-hooks`]) {
    await Deno.mkdir(made, { recursive: true });
  }
  await Deno.writeTextFile(log, "");

  await executable(
    `${wrap}/deno`,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${Deno.execPath()}' "$@"\n`,
  );
  // The agent: an empty roster, a background start that exits 0, a stop and
  // a remove that do nothing, and every other call refused.
  await executable(
    `${stubs}/claude`,
    `#!/bin/sh
case "$1" in
agents) echo '[]' ;;
--bg | stop | rm | -p) exit 0 ;;
*) exit 64 ;;
esac
`,
  );
  // The service manager, as tinyfleet's cli/tests/seat_add.rs stubs it: a
  // query answers not running until a load, and a load writes the
  // controller.started event a start confirms by.
  const pid = `${stubs}/pid`;
  await Deno.writeTextFile(pid, "");
  await executable(
    `${stubs}/manager`,
    `#!/bin/sh
verb=$1
if [ "$verb" = "--user" ]; then verb=$2; fi
case "$verb" in
print | show)
	if [ -s '${pid}' ]; then
		printf '\\tstate = running\\n\\tpid = %s\\n' "$(cat '${pid}')"
		printf 'MainPID=%s\\n' "$(cat '${pid}')"
		exit 0
	fi
	exit 1
	;;
bootout | stop) : > '${pid}' ;;
*)
	echo 4242 > '${pid}'
	stream='${machine}/events.jsonl'
	mkdir -p '${machine}'
	n=1
	if [ -f "$stream" ]; then n=$(( $(wc -l < "$stream") + 1 )); fi
	printf '{"id":"stub-%s","seq":%s,"ts":"2026-09-12T00:00:00Z","type":"controller.started","actor":{"kind":"controller","id":"a-machine"},"payload":{}}\\n' "$n" "$n" >> "$stream"
	;;
esac
`,
  );

  const env: Record<string, string> = {
    PATH: `${wrap}:${Deno.env.get("PATH") ?? ""}`,
    HOME: home,
    FLEET_HOME: home,
    FLEET_DIR: machine,
    FLEET_CLAUDE_BIN: `${stubs}/claude`,
    FLEET_SERVICE_BIN: `${stubs}/manager`,
    // The spawn's load belt reads these in place of the box's own load, so
    // a busy CI runner does not hold the transient seat back.
    FLEET_LOAD_AVERAGE: "0.1",
    FLEET_CPUS: "8",
    GIT_AUTHOR_NAME: "fleet-packs checks",
    GIT_AUTHOR_EMAIL: "checks@example.invalid",
    GIT_COMMITTER_NAME: "fleet-packs checks",
    GIT_COMMITTER_EMAIL: "checks@example.invalid",
  };
  const tracking = Deno.env.get("DO_NOT_TRACK");
  if (tracking !== undefined) env.DO_NOT_TRACK = tracking;

  await git(project, ["init", "--quiet", "--initial-branch", "main"]);
  await git(project, ["config", "core.hooksPath", `${dir}/no-hooks`]);
  return {
    dir,
    project,
    machine,
    env,
    log,
    main: `${machine}/packs/bd/adapters/store/bd/main.ts`,
  };
}

/** fleet in the project, with the rig's env and `extra` over it. */
async function fleetIn(
  at: Rig,
  args: string[],
  extra: Record<string, string> = {},
) {
  return await run(fleet, args, {
    cwd: at.project,
    env: { ...at.env, ...extra },
  });
}

/** `fleet <args>` must exit `code`. */
async function ok(
  at: Rig,
  args: string[],
  code = 0,
  extra: Record<string, string> = {},
): Promise<string> {
  const out = await fleetIn(at, args, extra);
  assertEquals(
    out.code,
    code,
    `fleet ${args.join(" ")}: ${out.stdout}${out.stderr}`,
  );
  return out.stdout;
}

/** bd in the project, its JSON answer's data. */
async function bd(at: Rig, args: string[]): Promise<Record<string, unknown>> {
  const out = await run("bd", [...args, "--json"], {
    cwd: at.project,
    env: at.env,
  });
  assertEquals(out.code, 0, `bd ${args.join(" ")}: ${out.stderr}`);
  const answer = JSON.parse(out.stdout);
  return "data" in answer ? answer.data : answer;
}

interface Shown {
  assignee: string | null;
  status: string;
  order: Record<string, unknown> | null;
  timeline: Record<string, unknown>[];
}

/** The item as `fleet item show --json` reads it back. */
async function shown(at: Rig, item: string): Promise<Shown> {
  const document = JSON.parse(await ok(at, ["item", "show", item, "--json"]));
  assert(document.ok, JSON.stringify(document));
  return document.data;
}

/** The verbs the pack's main.ts answered since the last read, in order. */
async function answered(at: Rig): Promise<string[]> {
  const lines = (await Deno.readTextFile(at.log)).split("\n").filter(Boolean);
  await Deno.writeTextFile(at.log, "");
  return lines.map((line) => {
    const words = line.split(" ");
    const entry = words.findIndex((word) => word === at.main);
    assert(entry >= 0, `deno ran something other than the pack: ${line}`);
    return words[entry + 1];
  });
}

/** Every verb in `wanted` is among the ones main.ts answered. */
function through(verbs: string[], wanted: string[]) {
  for (const verb of wanted) {
    assert(
      verbs.includes(verb),
      `main.ts answered ${verb}: it answered ${verbs.join(", ") || "nothing"}`,
    );
  }
}

/** The kinds of an item's timeline entries, oldest first. */
function kinds(item: Shown): unknown[] {
  return item.timeline.map((entry) => entry.kind);
}

/** One doctor row for bd-version, as `--json` carries it. */
async function doctorRow(at: Rig): Promise<Record<string, unknown>> {
  const out = await fleetIn(at, ["doctor", "bd-version", "--json"]);
  const document = JSON.parse(out.stdout);
  const rows = document.data.checks;
  assertEquals(rows.length, 1, JSON.stringify(rows));
  return rows[0];
}

/** The pack's two directories, copied into a repository of their own: what
 * `fleet pack add` fetches is this checkout's tree, committed or not. */
async function snapshot(at: Rig): Promise<string> {
  const source = `${at.dir}/fleet-packs`;
  for (const pack of ["adapters/store/bd", "runtimes/ts"]) {
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

Deno.test({
  name:
    "the smoke ring: fleet drives the bd pack's fenced writes on a real board",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async (t) => {
    const at = await rig();
    let item = "";
    let builder = "";
    let reviewer = "";
    try {
      await t.step(
        "fleet create makes the fleet; bd makes the board",
        async () => {
          await ok(at, ["create", "--embedded", "--agent", "claude_code"]);
          const init = await run("bd", [
            "init",
            "--prefix",
            "sm",
            "--quiet",
            "--skip-agents",
            "--skip-hooks",
          ], { cwd: at.project, env: at.env });
          assertEquals(init.code, 0, init.stderr);
          // What the fleet and bd write that the trunk does not version.
          await Deno.writeTextFile(
            `${at.project}/.git/info/exclude`,
            ".beads/\n.gitignore\nfleet.toml.lock\n",
            { append: true },
          );
        },
      );

      await t.step(
        "before the pack, bd-version is the defaults' check",
        async () => {
          const row = await doctorRow(at);
          assertEquals(row.layer, "defaults", JSON.stringify(row));
        },
      );

      await t.step(
        "the pack installs from this checkout, with ts",
        async () => {
          const source = await snapshot(at);
          const added = await ok(at, [
            "pack",
            "add",
            `${source}//adapters/store/bd`,
            "--version",
            "main",
          ]);
          assert(added.includes("added bd main"), added);
          assert(added.includes("added ts main"), added);
          assert((await Deno.stat(at.main)).isFile, at.main);
        },
      );

      await t.step(
        "the doctor check is the pack's, and reads the pin",
        async () => {
          const row = await doctorRow(at);
          assertEquals(row.layer, "bd", JSON.stringify(row));
          assertEquals(row.verdict, "pass", JSON.stringify(row));
          const said = String(row.stdout).split("\n");
          assert(
            said[0].startsWith(
              `bd-version: pinned bd ${PINNED}; \`bd version\` answers: bd version ${PINNED}`,
            ),
            said[0],
          );
          assertEquals(said[1], "bd-version: holds");
        },
      );

      await t.step(
        "seat add --agent lists a builder and a reviewer",
        async () => {
          builder =
            (await ok(at, ["seat", "add", "--agent", "--name", "builder"]))
              .trim();
          reviewer =
            (await ok(at, ["seat", "add", "--agent", "--name", "reviewer"]))
              .trim();
          assert(/^[0-9a-f-]{36}$/.test(builder), builder);
          assert(/^[0-9a-f-]{36}$/.test(reviewer), reviewer);
        },
      );

      await t.step(
        '[store] adapter = "bd" is the built-in, not the pack',
        async () => {
          await Deno.writeTextFile(
            `${at.project}/fleet.toml`,
            '\n[store]\nadapter = "bd"\n',
            { append: true },
          );
          item = String((await bd(at, ["create", "the ring's item"])).id);
          await answered(at);
          await shown(at, item);
          assertEquals(await answered(at), [], "the built-in ran no deno");
        },
      );

      await t.step(
        "the project names the pack's main.ts, and the pack answers",
        async () => {
          const policy = await Deno.readTextFile(`${at.project}/fleet.toml`);
          await Deno.writeTextFile(
            `${at.project}/fleet.toml`,
            policy.replace(
              '[store]\nadapter = "bd"\n',
              `[store]\nadapter = "${at.main}"\n\n[core]\nreviewer = "reviewer"\n`,
            ),
          );
          await git(at.project, ["add", "--", "fleet.toml"]);
          await git(at.project, [
            "commit",
            "--quiet",
            "--no-gpg-sign",
            "-m",
            "the trunk",
          ]);
          await git(at.project, [
            "update-ref",
            "refs/remotes/origin/main",
            "HEAD",
          ]);
          // fleet start renders the agent seats into the machine's seat list,
          // which a dispatch --to resolves them from.
          await ok(at, ["start"]);

          const item0 = await shown(at, item);
          through(await answered(at), ["show", "timeline"]);
          assertEquals(item0.assignee, null);
          assertEquals(item0.order, null);
        },
      );

      await t.step(
        "dispatch --to: the order, the index and the assignee",
        async () => {
          // 4: ordered, and the seat has no live session to ring.
          await ok(at, ["dispatch", item, "--to", "builder"], 4);
          through(await answered(at), ["order.set", "update", "append"]);
          const read = await shown(at, item);
          assertEquals(read.assignee, builder);
          assertEquals(read.order?.kind, "dispatch");
          assertEquals(read.order?.seat, builder);
          assertEquals(kinds(read), ["ordered"]);
        },
      );

      await t.step(
        "deliver --delivery: the delivered entry, and the reviewer holds it",
        async () => {
          await Deno.writeTextFile(
            `${at.dir}/delivery.json`,
            JSON.stringify(DELIVERY),
          );
          await git(at.project, [
            "checkout",
            "--quiet",
            "-b",
            "builder/feat/ring",
          ]);
          await Deno.writeTextFile(`${at.project}/the-work.txt`, "the work\n");
          await git(at.project, ["add", "--", "the-work.txt"]);
          await ok(
            at,
            ["deliver", "--delivery", `${at.dir}/delivery.json`],
            0,
            {
              FLEET_ACTOR: "builder",
            },
          );
          through(await answered(at), ["update", "append"]);
          const read = await shown(at, item);
          assertEquals(read.assignee, reviewer);
          assertEquals(kinds(read), ["ordered", "delivered"]);
          const delivered = read.timeline[1];
          assertEquals(
            delivered.commit,
            (await git(at.project, ["rev-parse", "HEAD"])).trim(),
          );
        },
      );

      await t.step(
        "review --return: the returned verdict, and the builder holds it again",
        async () => {
          await ok(at, [
            "review",
            item,
            "--return",
            FINDINGS,
            "--by",
            "reviewer",
          ]);
          through(await answered(at), ["update", "append"]);
          const read = await shown(at, item);
          assertEquals(read.assignee, builder);
          const verdict = read.timeline.at(-1);
          assertEquals(verdict?.kind, "reviewed", JSON.stringify(verdict));
          assertEquals(verdict?.verdict, "returned", JSON.stringify(verdict));
          // The verdict carries the takeoff's findings as the file holds
          // them, in order.
          const { findings } = JSON.parse(await Deno.readTextFile(FINDINGS));
          assert(findings.length > 0, "the SDK's fixture holds findings");
          assertEquals(verdict?.findings, findings, JSON.stringify(verdict));
        },
      );

      await t.step(
        "review --land: the accepted verdict on a second delivery",
        async () => {
          await Deno.writeTextFile(
            `${at.project}/the-work.txt`,
            "the work, fixed\n",
          );
          await git(at.project, ["add", "--", "the-work.txt"]);
          await ok(
            at,
            ["deliver", "--delivery", `${at.dir}/delivery.json`],
            0,
            {
              FLEET_ACTOR: "builder",
            },
          );
          await answered(at);
          await ok(at, ["review", item, "--land", "--by", "reviewer"]);
          through(await answered(at), ["append"]);
          const read = await shown(at, item);
          const verdict = read.timeline.at(-1);
          assertEquals(verdict?.kind, "reviewed", JSON.stringify(verdict));
          assertEquals(verdict?.verdict, "accepted", JSON.stringify(verdict));
          assertEquals(read.status, "open", "review --land lands nothing");
        },
      );

      await t.step(
        "a retire withdraws the order its transient seat held",
        async () => {
          await git(at.project, ["checkout", "--quiet", "main"]);
          const second = String(
            (await bd(at, ["create", "a transient seat's item"])).id,
          );
          await answered(at);
          await ok(at, ["dispatch", second]);
          through(await answered(at), ["order.set", "update", "append"]);
          const ordered = await shown(at, second);
          const seat = ordered.assignee;
          assert(seat, "the dispatch assigned the item to the seat it spawned");
          assertEquals(ordered.order?.seat, seat);

          const retired = await ok(at, ["seat", "retire", seat]);
          assert(retired.includes("retired agent-"), retired);
          through(await answered(at), ["order.withdraw", "append"]);
          const read = await shown(at, second);
          assertEquals(read.assignee, null);
          assertEquals(read.order, null);
          const withdrawn = read.timeline.at(-1);
          assertEquals(
            withdrawn?.kind,
            "order_withdrawn",
            JSON.stringify(withdrawn),
          );
          assertEquals(withdrawn?.seat, seat);
          assertEquals(withdrawn?.why, "retire");
        },
      );

      await t.step(
        "with the defaults' copy gone, bd-version is still the pack's",
        async () => {
          await Deno.remove(`${at.machine}/defaults/doctor/bd-version`, {
            recursive: true,
          });
          const out = await ok(at, ["doctor", "bd-version"]);
          assert(
            out.startsWith("pass bd-version (bd) — bd-version: holds"),
            out,
          );
          const row = await doctorRow(at);
          assertEquals(row.layer, "bd");
          assert(
            String(row.stdout).startsWith(`bd-version: pinned bd ${PINNED}; `),
            String(row.stdout),
          );
        },
      );
    } finally {
      // The spawned seat's worktree sits beside the project, under the rig.
      await Deno.remove(at.dir, { recursive: true }).catch(() => {});
    }
  },
});
