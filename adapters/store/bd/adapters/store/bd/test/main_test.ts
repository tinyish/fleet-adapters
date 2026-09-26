// main.ts end to end: the executable itself, run as fleet runs it — one
// process per call, the request on stdin — over a real bd on a scratch board
// made for the suite. Each quirk the unit arms carry on a recorded answer is
// taken here again on bd itself.
//
// SKIPPED WHERE NO bd RUNS, so the unit arms still run on a box without one;
// fleet-rsia.5's CI pins bd 1.3.0 and runs these.

import { assert, assertEquals } from "@std/assert";

const MAIN = new URL("../main.ts", import.meta.url).pathname;
const SEAT = "0199a3c4-7d8e-7f90-a1b2-c3d4e5f60718";

async function runs(bin: string, args: string[], cwd?: string) {
  try {
    const out = await new Deno.Command(bin, {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
    })
      .output();
    return {
      ok: out.success,
      stdout: new TextDecoder().decode(out.stdout),
      stderr: new TextDecoder().decode(out.stderr),
    };
  } catch {
    return { ok: false, stdout: "", stderr: "" };
  }
}

const HAS_BD = (await runs("bd", ["version"])).ok;

interface Called {
  exit: number;
  answer: Record<string, unknown> | undefined;
  stderr: string;
}

/** One call of main.ts, as fleet makes it. */
async function call(
  verb: string,
  request: Record<string, unknown>,
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
  await writer.write(
    new TextEncoder().encode(JSON.stringify({ schema_version: 1, ...request })),
  );
  await writer.close();
  const out = await child.output();
  const stdout = new TextDecoder().decode(out.stdout).trim();
  return {
    exit: out.code,
    answer: stdout === "" ? undefined : JSON.parse(stdout),
    stderr: new TextDecoder().decode(out.stderr).trim(),
  };
}

/** One bd call on the board, answering its JSON's data. */
async function bd(root: string, ...args: string[]): Promise<unknown> {
  const out = await runs("bd", ["-C", root, ...args, "--json"]);
  if (!out.ok) throw new Error(`bd ${args.join(" ")}: ${out.stderr}`);
  const answer = JSON.parse(out.stdout);
  return "data" in answer ? answer.data : answer;
}

async function filed(
  root: string,
  title: string,
  ...more: string[]
): Promise<string> {
  const row = await bd(
    root,
    "create",
    "--title",
    title,
    "--description",
    "filed by main_test",
    "--type",
    "task",
    "--actor",
    "run:main-test",
    ...more,
  ) as { id: string };
  return row.id;
}

function hash(id: string): string {
  return id.slice(id.indexOf("-") + 1);
}

Deno.test({
  name: "main.ts answers the read verbs over a real bd board",
  ignore: !HAS_BD,
  async fn(t) {
    const dir = await Deno.makeTempDir({ prefix: "bd-pack-" });
    const root = `${dir}/board`;
    const absent = `${dir}/absent`;
    await Deno.mkdir(root);
    await Deno.mkdir(absent);
    try {
      const init = await runs(
        "bd",
        ["init", "--prefix", "fx", "--quiet"],
        root,
      );
      assert(init.ok, init.stderr);

      // Items until two ids' hashes open with the same character, which is a
      // fragment naming both: 37 is one more than the characters a base-36
      // hash can open with.
      const ids: string[] = [];
      let pair: [string, string] | undefined;
      while (pair === undefined && ids.length < 37) {
        const id = await filed(root, `item ${ids.length}`);
        const twin = ids.find((other) => hash(other)[0] === hash(id)[0]);
        if (twin !== undefined) pair = [twin, id];
        ids.push(id);
      }
      assert(pair !== undefined, `no two of ${ids} open alike`);
      const [one] = ids;

      await t.step("version names bd and its version", async () => {
        const { exit, answer } = await call("version", { root });
        assertEquals(exit, 0);
        assertEquals(answer?.name, "bd");
        assert(/^[0-9]/.test(String(answer?.version)), String(answer?.version));
      });

      await t.step(
        "capabilities answer no prefix bd init left commented",
        async () => {
          const { exit, answer } = await call("capabilities", { root });
          assertEquals([exit, answer?.item_prefix, answer?.cli], [
            0,
            null,
            "bd",
          ]);
        },
      );

      await t.step(
        "an id resolves whole, by its hash and by a prefix of it",
        async () => {
          const opening = hash(one).slice(0, 2);
          const alone = ids.filter((id) =>
            hash(id).startsWith(opening)
          ).length === 1;
          for (const text of [one, hash(one), ...(alone ? [opening] : [])]) {
            const resolved = await call("resolve", { root, id: text });
            const shown = await call("show", { root, id: text });
            assertEquals([resolved.exit, resolved.answer?.id], [0, one], text);
            assertEquals((shown.answer?.item as { id: string }).id, one, text);
          }
        },
      );

      await t.step(
        "an ambiguous fragment refuses ambiguous, naming both",
        async () => {
          const fragment = hash(pair![0])[0];
          const { exit, answer, stderr } = await call("show", {
            root,
            id: fragment,
          });
          assertEquals(exit, 1);
          const refused = answer?.refused as {
            reason: string;
            candidates: string[];
          };
          assertEquals(refused.reason, "ambiguous");
          assert(
            pair!.every((id) => refused.candidates.includes(id)),
            JSON.stringify(refused),
          );
          assert(stderr.includes("matches more than one item"), stderr);
        },
      );

      await t.step("an id no item carries refuses missing", async () => {
        for (const verb of ["show", "resolve", "timeline"]) {
          const { exit, answer } = await call(verb, {
            root,
            id: "fx-nobody-filed-this",
          });
          assertEquals(exit, 1, verb);
          assertEquals(
            (answer?.refused as { reason: string }).reason,
            "missing",
            verb,
          );
        }
      });

      await t.step("a root holding no store is could not tell", async () => {
        for (
          const [verb, request] of [["show", { id: "x" }], ["list", {
            filter: "ready",
          }]]
        ) {
          const { exit, answer } = await call(verb as string, {
            root: absent,
            ...request as object,
          });
          assertEquals(exit, 3, verb as string);
          assert(
            String(answer?.error).includes("no beads project found"),
            answer?.error as string,
          );
        }
      });

      await t.step(
        "a label lists every open item under it past list.limit",
        async () => {
          await runs("bd", ["-C", root, "config", "set", "list.limit", "1"]);
          const label = "main-test-label";
          const under = [
            await filed(root, "under a label", "--labels", label),
            await filed(root, "under it too", "--labels", label),
          ];
          const { exit, answer } = await call("list", {
            root,
            filter: { label },
          });
          assertEquals(exit, 0);
          assertEquals(
            (answer?.items as { id: string }[]).map((item) => item.id)
              .toSorted(),
            under.toSorted(),
          );
          const ready = await call("list", { root, filter: "ready" });
          assert((ready.answer?.items as unknown[]).length > 2);
        },
      );

      await t.step("a seat's listing carries the items it closed", async () => {
        const held = await filed(root, "held and closed by a seat");
        await bd(
          root,
          "update",
          held,
          "--assignee",
          SEAT,
          "--actor",
          "run:main-test",
        );
        await bd(root, "close", held, "--reason", "done", "--actor", SEAT);
        const { exit, answer } = await call("list", {
          root,
          filter: { assignee: SEAT },
        });
        assertEquals(exit, 0);
        assertEquals(answer?.items, [
          {
            id: held,
            title: "held and closed by a seat",
            status: "closed",
            type: "task",
            labels: [],
            assignee: SEAT,
            order: { state: "none" },
            run: null,
            foreign: [],
          },
        ]);
      });

      await t.step(
        "a timeline answers fleet's entries and leaves a person's out",
        async () => {
          const entry =
            '{"fleet.entry":1,"kind":"ordered","order":"dispatch","seat":null}';
          await bd(
            root,
            "comments",
            "add",
            one,
            entry,
            "--actor",
            `seat:${SEAT}`,
          );
          await bd(
            root,
            "comments",
            "add",
            one,
            "a person says hi",
            "--actor",
            "alberto",
          );
          const { exit, answer } = await call("timeline", { root, id: one });
          assertEquals(exit, 0);
          const entries = answer?.entries as Record<string, unknown>[];
          assertEquals(entries.length, 1);
          assertEquals(
            [entries[0].kind, entries[0].order, entries[0].by],
            ["ordered", "dispatch", `seat:${SEAT}`],
          );
          assert(
            /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(String(entries[0].at)),
            String(entries[0].at),
          );
        },
      );

      await t.step(
        "$FLEET_BD_BIN names the bd run, by absolute path",
        async () => {
          const log = `${dir}/argv`;
          const stub = `${dir}/stub-bd`;
          await Deno.writeTextFile(
            stub,
            `#!/bin/sh\nprintf '%s\\n' "envelope=$BD_JSON_ENVELOPE" "$@" >> '${log}'\nexec bd "$@"\n`,
          );
          await Deno.chmod(stub, 0o755);
          const { exit } = await call("list", { root, filter: "ready" }, {
            FLEET_BD_BIN: stub,
          });
          assertEquals(exit, 0);
          assertEquals((await Deno.readTextFile(log)).trim().split("\n"), [
            "envelope=1",
            "-C",
            root,
            "ready",
            "--json",
            "-n",
            "0",
          ]);
          const relative = await call("list", { root, filter: "ready" }, {
            FLEET_BD_BIN: "stub-bd",
          });
          assertEquals(relative.exit, 3);
          assertEquals(
            relative.stderr.split("\n").at(-1),
            "the item-tracker seam names `stub-bd`, which is not an absolute path",
          );
        },
      );

      await t.step(
        "a verb not built yet is usage, and nothing is written",
        async () => {
          const { exit, answer, stderr } = await call("create", {
            root,
            item: { title: "t", description: "", type: "task", labels: [] },
            by: "run:main-test",
          });
          assertEquals([exit, answer], [2, undefined]);
          assertEquals(stderr, "the bd pack does not answer `create` yet");
        },
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
