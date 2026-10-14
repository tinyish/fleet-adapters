// main.ts end to end: the executable itself, run as fleet runs it — one
// process per call, the request on stdin — over a real bd on a scratch board
// made for the suite. Each quirk the unit arms carry on a recorded answer is
// taken here again on bd itself.
//
// SKIPPED WHERE NO bd RUNS, so the unit arms still run on a box without one;
// fleet-rsia.5's CI pins bd 1.3.0 and runs these.

import { assert, assertEquals } from "@std/assert";
import { CONTRACT } from "../lib/answer.ts";
import { HANDLERS } from "../main.ts";

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
  cwd?: string,
): Promise<Called> {
  const child = new Deno.Command(MAIN, {
    args: [verb],
    env,
    cwd,
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

      // The first verb of the contract this pack does not answer yet, while
      // one is left: fleet-rsia.3 built `create`, which this step first asked.
      const unbuilt = Object.keys(CONTRACT.verbs).find((verb) =>
        !(verb in HANDLERS)
      );
      await t.step({
        name: "a verb not built yet is usage, and nothing is written",
        ignore: unbuilt === undefined,
        async fn() {
          const { exit, answer, stderr } = await call(unbuilt!, { root });
          assertEquals([exit, answer], [2, undefined]);
          assertEquals(
            stderr,
            `the bd pack does not answer \`${unbuilt}\` yet`,
          );
        },
      });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

/**
 * The plain writes over a real bd board, each step naming the conformance
 * check (core/src/store/conformance.rs at tinyfleet 7fadcde) whose assertions
 * it takes: `fleet store check` runs them only once fleet-rsia.4's scratch
 * lands, so these are the writes' proof until it does. The withdrawals in
 * checks 22 and 25 are fleet-rsia.4's `order.withdraw`, and left to it.
 */
Deno.test({
  name: "main.ts answers the plain writes over a real bd board",
  ignore: !HAS_BD,
  async fn(t) {
    const dir = await Deno.makeTempDir({ prefix: "bd-pack-writes-" });
    const root = dir;
    const BY = "run:fleet-conformance";
    const NOBODY = "fleet-conformance-nobody-filed-this";
    const OTHER = "0199a3c4-7d8e-7f90-a1b2-c3d4e5f60719";
    const THIRD = "0199a3c4-7d8e-7f90-a1b2-c3d4e5f6071a";
    try {
      const init = await runs(
        "bd",
        ["init", "--prefix", "fx", "--quiet"],
        root,
      );
      assert(init.ok, init.stderr);

      type Shown = {
        id: string;
        title: string;
        description: string;
        status: string;
        type: string;
        labels: string[];
        assignee: string | null;
        order: { state: string };
        run: unknown;
      };
      const show = async (id: string): Promise<Shown> => {
        const shown = await call("show", { root, id });
        assertEquals(shown.exit, 0, shown.stderr);
        return shown.answer?.item as Shown;
      };
      const create = async (title: string, more: object = {}) => {
        const made = await call("create", {
          root,
          item: {
            title,
            description: "an item the conformance suite filed",
            type: "task",
            labels: ["fleet-conformance"],
            ...more,
          },
          by: BY,
        });
        assertEquals(made.exit, 0, made.stderr);
        return made.answer?.id as string;
      };
      const update = (id: string, change: object) =>
        call("update", { root, id, by: BY, ...change });
      const took = async (id: string, change: object) => {
        const done = await update(id, change);
        assertEquals(
          [done.exit, done.answer],
          [0, { schema_version: 1 }],
          done.stderr,
        );
      };
      /** A fenced write the item did not meet: exit 1, moved, naming each of `names`. */
      const moved = async (id: string, change: object, names: string[]) => {
        const { exit, answer, stderr } = await update(id, change);
        assertEquals(exit, 1, stderr);
        const refused = answer?.refused as { reason: string; message: string };
        assertEquals(refused.reason, "moved");
        for (const name of names) {
          assert(refused.message.includes(name), `${name}: ${refused.message}`);
        }
        assertEquals(stderr.split("\n").at(-1), refused.message);
      };
      const reason = (answer: Called) =>
        (answer.answer?.refused as { reason: string } | undefined)?.reason;
      const closeBy = (id: string, by: string, why = "closed by main_test") =>
        call("close", { root, id, by, reason: why });
      const count = async () =>
        (await bd(root, "list", "--all", "-n", "0") as unknown[]).length;

      await t.step(
        "create then show (check 4): the item filed reads back whole",
        async () => {
          const id = await create("an item to read back", {
            labels: ["fleet-conformance", "a,b"],
            priority: 1,
          });
          const item = await show(id);
          assertEquals(item.id, id);
          assertEquals(
            [item.title, item.description, item.status, item.type],
            [
              "an item to read back",
              "an item the conformance suite filed",
              "open",
              "task",
            ],
          );
          assertEquals(item.labels.toSorted(), ["a,b", "fleet-conformance"]);
          assertEquals([item.assignee, item.order, item.run], [null, {
            state: "none",
          }, null]);
          const row =
            (await bd(root, "show", id) as Record<string, unknown>[])[0];
          assertEquals(
            [row.priority, row.created_by],
            [1, BY],
            "--priority and --actor were sent",
          );
        },
      );

      await t.step(
        "create refuses priority 5 before anything is sent",
        async () => {
          const before = await count();
          const refused = await call("create", {
            root,
            item: {
              title: "too urgent",
              description: "",
              type: "task",
              priority: 5,
            },
            by: BY,
          });
          assertEquals([refused.exit, refused.answer], [2, undefined]);
          assert(
            refused.stderr.includes("priority is 5, above 4"),
            refused.stderr,
          );
          assertEquals(await count(), before, "nothing was filed");
        },
      );

      await t.step(
        "missing is refused (check 6): a write to an id no item carries answers missing",
        async () => {
          const entry = {
            "fleet.entry": 1,
            kind: "ordered",
            order: "dispatch",
          };
          for (
            const [verb, request] of [
              ["update", { title: "a title for nobody" }],
              ["update", { title: "a title for nobody", if_assignee: null }],
              ["update", { assignee: SEAT, if_assignee: OTHER }],
              ["append", { entry }],
              ["close", { reason: "r" }],
            ] as const
          ) {
            const answer = await call(verb, {
              root,
              id: NOBODY,
              by: BY,
              ...request,
            });
            assertEquals(
              [answer.exit, reason(answer)],
              [1, "missing"],
              `${verb} ${answer.stderr}`,
            );
          }
        },
      );

      await t.step(
        "update (check 12): a title, an assignee, both in one call, and nobody",
        async () => {
          const id = await create("the title it was filed under");
          await took(id, { title: "the title it carries now" });
          let now = await show(id);
          assertEquals([now.title, now.assignee], [
            "the title it carries now",
            null,
          ]);
          await took(id, { assignee: SEAT });
          now = await show(id);
          assertEquals([now.title, now.assignee], [
            "the title it carries now",
            SEAT,
          ]);
          await took(id, {
            title: "the title and the holder both moved",
            assignee: OTHER,
          });
          now = await show(id);
          assertEquals([now.title, now.assignee], [
            "the title and the holder both moved",
            OTHER,
          ]);
          await took(id, { assignee: null });
          now = await show(id);
          assertEquals([now.title, now.assignee], [
            "the title and the holder both moved",
            null,
          ]);
        },
      );

      await t.step(
        "update naming nothing (check 21): usage, exit 2, and nothing is written",
        async () => {
          const id = await create("an item an empty update reaches");
          await took(id, { assignee: SEAT });
          for (const change of [{}, { title: null }, { if_assignee: SEAT }]) {
            const answer = await update(id, change);
            assertEquals(
              [answer.exit, answer.answer],
              [2, undefined],
              JSON.stringify(change),
            );
            assertEquals(
              answer.stderr,
              "an update names no title, assignee or status — nothing was written",
            );
          }
          const now = await show(id);
          assertEquals([now.title, now.assignee], [
            "an item an empty update reaches",
            SEAT,
          ]);
        },
      );

      await t.step(
        "fenced update refuses moved (check 23): a missed fence writes nothing",
        async () => {
          const title = "an item a fenced update reaches";
          const id = await create(title);
          await took(id, { assignee: SEAT, if_assignee: null });
          assertEquals(
            (await show(id)).assignee,
            SEAT,
            "fenced on nobody, on an item never held",
          );
          for (const fence of [OTHER, null]) {
            await moved(
              id,
              {
                title: "a title nothing writes",
                assignee: OTHER,
                if_assignee: fence,
              },
              [id, SEAT],
            );
            const now = await show(id);
            assertEquals(
              [now.title, now.assignee],
              [title, SEAT],
              `fenced on ${fence}`,
            );
          }
          await took(id, {
            title: "the title its holder's fence let through",
            if_assignee: SEAT,
          });
          let now = await show(id);
          assertEquals(
            [now.title, now.assignee],
            ["the title its holder's fence let through", SEAT],
          );
          await took(id, { assignee: null, if_assignee: SEAT });
          assertEquals((await show(id)).assignee, null);
          await took(id, { assignee: OTHER, if_assignee: null });
          now = await show(id);
          assertEquals(
            now.assignee,
            OTHER,
            "fenced on nobody, on an item whose holder was cleared",
          );
        },
      );

      await t.step(
        "fenced writes (check 22): a reopen, and hand-overs fenced on the holder read",
        async () => {
          const id = await create("an item a fenced write reaches");
          await took(id, { assignee: SEAT });
          const closed = await closeBy(
            id,
            `seat:${SEAT}`,
            "landed by its seat",
          );
          assertEquals(closed.exit, 0, closed.stderr);
          await took(id, { status: "open" });
          let now = await show(id);
          assertEquals(
            [now.status, now.assignee],
            ["open", SEAT],
            "a reopen, from a non-holder",
          );
          await took(id, { assignee: null, if_assignee: SEAT });
          await moved(id, { assignee: OTHER, if_assignee: SEAT }, [id]);
          assertEquals(
            (await show(id)).assignee,
            null,
            "a hand-over that was moved",
          );
          await took(id, { assignee: OTHER, if_assignee: null });
          await took(id, { assignee: THIRD, if_assignee: OTHER });
          now = await show(id);
          assertEquals(now.assignee, THIRD, "the holder after two hand-overs");
        },
      );

      await t.step(
        "reopen through update (check 24): fenced on its holder, open and held by nobody",
        async () => {
          const id = await create("an item an update reopens");
          await took(id, { assignee: SEAT });
          assertEquals((await closeBy(id, `seat:${SEAT}`)).exit, 0);
          const untouched = async (after: string) => {
            const now = await show(id);
            assertEquals([now.assignee, now.status], [SEAT, "closed"], after);
          };
          await moved(
            id,
            { assignee: null, status: "open", if_assignee: null },
            [id, SEAT],
          );
          await untouched("a reopen fenced on nobody");
          const usage = await update(id, {
            status: "in_progress",
            if_assignee: SEAT,
          });
          assertEquals([usage.exit, usage.answer], [2, undefined]);
          await untouched("an update to in_progress");
          await took(id, { assignee: null, status: "open", if_assignee: SEAT });
          const now = await show(id);
          assertEquals([now.status, now.assignee], ["open", null]);
          const ready = await call("list", { root, filter: "ready" });
          assert(
            (ready.answer?.items as { id: string }[]).some((row) =>
              row.id === id
            ),
            `${id} is back in the ready set`,
          );
        },
      );

      await t.step(
        "a non-holder moves an in_progress item's holder only through the fence",
        async () => {
          const id = await create("an item its seat is working");
          await took(id, { assignee: SEAT });
          await bd(
            root,
            "update",
            id,
            "--status",
            "in_progress",
            "--actor",
            SEAT,
          );
          const plain = await update(id, { assignee: OTHER });
          assertEquals(plain.exit, 3);
          assert(
            String(plain.answer?.error).includes(`cannot reassign ${id}`),
            plain.stderr,
          );
          assertEquals((await show(id)).assignee, SEAT);
          await took(id, { assignee: OTHER, if_assignee: SEAT });
          assertEquals((await show(id)).assignee, OTHER);
          await took(id, { status: "open" });
          const now = await show(id);
          assertEquals(
            [now.status, now.assignee],
            ["open", OTHER],
            "the status is not the holder's alone",
          );
        },
      );

      await t.step(
        "timeline is append-only and ordered (check 16): append answers each comment's id",
        async () => {
          const id = await create("an item with a timeline");
          const empty = await call("timeline", { root, id });
          assertEquals([empty.exit, empty.answer?.entries], [0, []]);
          const bodies = [
            { kind: "ordered", order: "dispatch", seat: SEAT },
            { kind: "order_withdrawn", why: "retire", seat: SEAT, cause: null },
            {
              kind: "delivered",
              commit: "1111111111111111111111111111111111111111",
              branch: "work/fleet-conformance",
              base: "0123456789abcdef0123456789abcdef01234567",
              files: ["core/src/store/conformance.rs"],
              checks: [],
              suite: { command: "fleet store check", rc: 0 },
              spec_corrections: [],
              not_proven: [{
                surface: "a store under load",
                command: "fleet store check",
              }],
              decisions: [],
              covers: [],
            },
          ];
          const sent: string[] = [];
          for (const body of bodies) {
            const appended = await call("append", {
              root,
              id,
              by: `seat:${SEAT}`,
              entry: { ...body, "fleet.entry": 1 },
            });
            assertEquals(appended.exit, 0, appended.stderr);
            sent.push(appended.answer?.entry as string);
          }
          assertEquals(
            new Set(sent).size,
            3,
            `each entry has an id of its own: ${sent}`,
          );
          const comments = await bd(root, "comments", id) as { id: string }[];
          assertEquals(
            comments.map((comment) => comment.id),
            sent,
            "the ids are bd's comments'",
          );
          const { exit, answer } = await call("timeline", { root, id });
          assertEquals(exit, 0);
          const entries = answer?.entries as Record<string, unknown>[];
          assertEquals(entries.map((entry) => entry.id), sent);
          for (const [n, entry] of entries.entries()) {
            const { id: _, at, by, ...body } = entry;
            assertEquals(body, bodies[n]);
            assertEquals(by, `seat:${SEAT}`);
            assert(
              typeof at === "string" && at !== "",
              `entry ${n} carries a time`,
            );
          }
          const absent = await call("timeline", { root, id: NOBODY });
          assertEquals([absent.exit, reason(absent)], [1, "missing"]);
        },
      );

      await t.step(
        "close (check 18): a second close answers already, and writes nothing",
        async () => {
          const id = await create("an item to close");
          assertEquals((await show(id)).status, "open");
          const first = await closeBy(id, BY, "the first close's reason");
          assertEquals(
            [first.exit, first.answer],
            [0, { schema_version: 1 }],
            first.stderr,
          );
          assertEquals((await show(id)).status, "closed");
          const second = await closeBy(id, BY, "the second close's reason");
          assertEquals([second.exit, reason(second)], [1, "already"]);
          assert(
            (second.answer?.refused as { message: string }).message.includes(
              id,
            ),
            second.stderr,
          );
          assertEquals((await show(id)).status, "closed");
          const row =
            (await bd(root, "show", id) as Record<string, unknown>[])[0];
          assertEquals(row.close_reason, "the first close's reason");
        },
      );

      await t.step(
        "a seat closes an item it holds, as its bare id (fleet-pjl)",
        async () => {
          const id = await create("an item its seat lands");
          await took(id, { assignee: SEAT });
          const closed = await closeBy(id, `seat:${SEAT}`);
          assertEquals(closed.exit, 0, closed.stderr);
          assertEquals((await show(id)).status, "closed");
        },
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

/** An item's row off bd itself, as the board holds it. */
async function row(root: string, id: string): Promise<Record<string, unknown>> {
  const rows = await bd(root, "show", id) as Record<string, unknown>[];
  return rows[0];
}

/** What `show` answers through main.ts. */
async function shown(
  root: string,
  id: string,
): Promise<Record<string, unknown>> {
  const { exit, answer, stderr } = await call("show", { root, id });
  assertEquals(exit, 0, stderr);
  return answer?.item as Record<string, unknown>;
}

function refusedAs(called: Called): string {
  return (called.answer?.refused as { reason: string } | undefined)?.reason ??
    `exit ${called.exit}: ${called.stderr}`;
}

Deno.test({
  name:
    "main.ts answers orders, runs, holds, export and scratch over a real bd board",
  ignore: !HAS_BD,
  async fn(t) {
    const dir = await Deno.makeTempDir({ prefix: "bd-pack-" });
    const BY = "run:main-test";
    const OTHER = "0199a3c4-7d8e-7f90-a1b2-c3d4e5f60719";
    const ORDER = {
      kind: "dispatch",
      by: "run:main-test-architect",
      seat: SEAT,
      at: "2026-09-13T00:00:00Z",
    };
    const RECORD = {
      hash: "h1",
      workflow: "greet",
      pack: "ts",
      entry: "greet.ts",
      started_at: "2026-09-13T00:00:00Z",
    };
    let root = "";
    try {
      await t.step(
        "scratch into a directory holding anything makes nothing",
        async () => {
          const full = `${dir}/full`;
          await Deno.mkdir(full);
          await Deno.writeTextFile(`${full}/keep.txt`, "a person's file");
          const refused = await call("scratch", { root: dir, into: full });
          assertEquals(refused.exit, 3, refused.stderr);
          assert(refused.stderr.includes("holds keep.txt"), refused.stderr);
          const left = [];
          for await (const entry of Deno.readDir(full)) left.push(entry.name);
          assertEquals(left, ["keep.txt"]);
        },
      );

      await t.step(
        "scratch into an empty directory makes a store naming its prefix",
        async () => {
          await Deno.mkdir(`${dir}/store`);
          // `into` relative to the request's root, as a person might send it.
          const made = await call("scratch", { root: dir, into: "store" });
          assertEquals(made.exit, 0, made.stderr);
          root = made.answer?.root as string;
          assertEquals(root, `${dir}/store`);
          const config = await Deno.readTextFile(`${root}/.beads/config.yaml`);
          assert(/^issue-prefix: "fx"$/m.test(config), config);
          const declared = await call("capabilities", { root });
          assertEquals(declared.answer?.item_prefix, "fx");
          assertEquals(declared.answer?.export, {
            file: ".beads/issues.jsonl",
            dir: ".beads/",
          });
          assertEquals(declared.answer?.scratch, true);
          assert((await filed(root, "the first")).startsWith("fx-"));
          const holds = await call("holds.open", { root });
          assertEquals([holds.exit, holds.answer?.holds], [0, []]);
        },
      );

      await t.step(
        "order.set and run.set keep each other and another writer's keys, which are foreign",
        async () => {
          const id = await filed(
            root,
            "an item ordered twice",
            "--labels",
            "t",
          );
          const theirs = {
            orders: { seat: "another-tools-seat" },
            a_prior_key: 7,
          };
          await bd(
            root,
            "update",
            id,
            "--metadata",
            JSON.stringify(theirs),
            "--actor",
            "someone",
          );
          const second = { ...ORDER, kind: "review", seat: OTHER };
          const later = { ...RECORD, hash: "h2" };
          for (
            const [verb, body] of [
              ["run.set", { run: RECORD }],
              ["order.set", { order: ORDER }],
              ["order.set", { order: second }],
              ["run.set", { run: later }],
            ] as const
          ) {
            const done = await call(verb, { root, id, by: BY, ...body });
            assertEquals(
              [done.exit, done.answer],
              [0, { schema_version: 1 }],
              done.stderr,
            );
          }
          const item = await shown(root, id);
          assertEquals(item.order, { state: "ordered", order: second });
          assertEquals(item.run, later);
          assertEquals(item.assignee, null, "an order touches no assignee");
          assertEquals((item.foreign as string[]).toSorted(), [
            "a_prior_key",
            "orders",
          ]);
          const metadata = (await row(root, id)).metadata as Record<
            string,
            unknown
          >;
          assertEquals([metadata.orders, metadata.a_prior_key], [
            theirs.orders,
            7,
          ]);
          const listed = await call("list", { root, filter: { label: "t" } });
          const summary = (listed.answer?.items as Record<string, unknown>[])
            .find((one) => one.id === id);
          assertEquals((summary?.foreign as string[]).toSorted(), [
            "a_prior_key",
            "orders",
          ]);

          const transient = { kind: "dispatch", by: BY, at: RECORD.started_at };
          await call("order.set", { root, id, by: BY, order: transient });
          assertEquals((await shown(root, id)).order, {
            state: "ordered",
            order: transient,
          });
        },
      );

      await t.step("a write to an id no item carries is missing", async () => {
        for (
          const [verb, body] of [
            ["order.set", { order: ORDER }],
            ["run.set", { run: RECORD }],
            ["order.withdraw", {}],
            ["order.withdraw", { if_assignee: null }],
            ["hold.raise", { reason: "r" }],
          ] as const
        ) {
          const refused = await call(verb, {
            root,
            id: "fx-nobody",
            by: BY,
            ...body,
          });
          assertEquals(
            [refused.exit, refusedAs(refused)],
            [1, "missing"],
            verb,
          );
        }
        const clear = await call("hold.clear", {
          root,
          hold: "fx-nobody",
          by: BY,
        });
        assertEquals([clear.exit, refusedAs(clear)], [1, "missing"]);
      });

      await t.step(
        "a withdrawal whose fence the item does not meet is moved, with nothing written",
        async () => {
          const id = await filed(root, "an item a withdrawal reaches");
          await bd(root, "update", id, "--assignee", SEAT, "--actor", BY);
          await call("run.set", { root, id, by: BY, run: RECORD });
          await call("order.set", { root, id, by: BY, order: ORDER });
          await bd(root, "close", id, "--reason", "landed", "--actor", SEAT);
          const before = await shown(root, id);
          for (
            const [fence, named] of [
              [{ if_assignee: OTHER, if_status: "closed" }, SEAT],
              [{ if_assignee: null, if_status: "closed" }, SEAT],
              [{ if_assignee: SEAT, if_status: "open" }, "closed"],
            ] as const
          ) {
            const missed = await call("order.withdraw", {
              root,
              id,
              by: BY,
              reopen: true,
              ...fence,
            });
            assertEquals(
              [missed.exit, refusedAs(missed)],
              [1, "moved"],
              missed.stderr,
            );
            const said =
              (missed.answer?.refused as { message: string }).message;
            assert(said.includes(id) && said.includes(named), said);
            assertEquals(await shown(root, id), before, "nothing was written");
          }

          const reopened = await call("order.withdraw", {
            root,
            id,
            by: BY,
            if_assignee: SEAT,
            if_status: "closed",
            reopen: true,
          });
          assertEquals(reopened.exit, 0, reopened.stderr);
          const now = await shown(root, id);
          assertEquals(
            [now.assignee, now.order, now.status, now.run],
            [null, { state: "none" }, "open", RECORD],
          );
          const ready = await call("list", { root, filter: "ready" });
          assert(
            (ready.answer?.items as { id: string }[]).some((one) =>
              one.id === id
            ),
            `${id} is back in the ready set`,
          );

          // Unfenced, the same one act: the holder and the order both go.
          await bd(root, "update", id, "--assignee", SEAT, "--actor", BY);
          await call("order.set", { root, id, by: BY, order: ORDER });
          const plain = await call("order.withdraw", { root, id, by: BY });
          assertEquals(plain.exit, 0, plain.stderr);
          const after = await shown(root, id);
          assertEquals([after.assignee, after.order, after.status], [null, {
            state: "none",
          }, "open"]);
        },
      );

      await t.step(
        "a hold takes its item out of ready, and a second clear answers already",
        async () => {
          const id = await filed(root, "an item to hold");
          const raised = await call("hold.raise", {
            root,
            id,
            by: BY,
            reason: "a question",
          });
          assertEquals(raised.exit, 0, raised.stderr);
          const hold = raised.answer?.hold as string;
          assert(hold.startsWith("fx-") && hold !== id, hold);
          const open = await call("holds.open", { root });
          assertEquals(open.answer?.holds, [hold]);
          const ready = async () =>
            ((await call("list", { root, filter: "ready" })).answer?.items as {
              id: string;
            }[])
              .map((one) => one.id);
          assert(!(await ready()).includes(id), "held, it is not ready");

          const cleared = await call("hold.clear", { root, hold, by: BY });
          assertEquals([cleared.exit, cleared.answer], [0, {
            schema_version: 1,
          }], cleared.stderr);
          assertEquals((await call("holds.open", { root })).answer?.holds, []);
          assert((await ready()).includes(id), "cleared, it is ready again");

          const again = await call("hold.clear", { root, hold, by: BY });
          assertEquals([again.exit, refusedAs(again)], [1, "already"]);
          assertEquals(
            (again.answer?.refused as { message: string }).message,
            `${hold} is already cleared`,
          );
          const notGate = await call("hold.clear", { root, hold: id, by: BY });
          assertEquals([notGate.exit, refusedAs(notGate)], [1, "missing"]);
        },
      );

      await t.step(
        "export writes under a relative into, resolved against the root and not the caller's directory",
        async () => {
          const elsewhere = `${dir}/elsewhere`;
          await Deno.mkdir(elsewhere);
          const id = await filed(root, "an item the export carries");
          const exported = await call(
            "export",
            { root, into: "lane" },
            {},
            elsewhere,
          );
          assertEquals(exported.exit, 0, exported.stderr);
          const file = `${root}/lane/.beads/issues.jsonl`;
          assertEquals(exported.answer?.file, file);
          assert((await Deno.readTextFile(file)).includes(id));
          const left = [];
          for await (const entry of Deno.readDir(elsewhere)) {
            left.push(entry.name);
          }
          assertEquals(
            left,
            [],
            "nothing was written under the caller's directory",
          );

          const home = await call(
            "export",
            { root, into: root },
            {},
            elsewhere,
          );
          assertEquals(home.answer?.file, `${root}/.beads/issues.jsonl`);
          const before = await Deno.readTextFile(`${root}/.beads/issues.jsonl`);
          await bd(root, "comments", "add", id, "a line", "--actor", BY);
          await call("export", { root, into: root });
          assert(
            (await Deno.readTextFile(`${root}/.beads/issues.jsonl`)) !== before,
            "the export moves with the timeline",
          );
        },
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
