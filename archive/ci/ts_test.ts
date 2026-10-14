// The ts pack as it ships, checked against the fleet FLEET_BIN names: the
// runtime it pins, the doctor instance that measures that runtime, and the
// SDK's spelling of the stream. The SDK's own suite runs beside this, from
// ci/check-ts.sh.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { fleet, root, run, scratch } from "./fleet.ts";

const ts = `${root}/runtimes/ts`;

Deno.test("the ts pack checks clean, imports nothing, and pins deno 2.9.7 with the bundle and run lines core execs", async () => {
  const out = await run(fleet, ["pack", "check", ts]);
  assertEquals(out.code, 0, `${out.stdout}${out.stderr}`);
  for (
    const line of [
      "pack ts 0.1.0 — schema 3",
      "runtime deno 2.9.7",
      "slot doctor: 1 entry",
    ]
  ) {
    assert(
      out.stdout.includes(line),
      `the report names ${line} — ${out.stdout}`,
    );
  }

  const manifest = await Deno.readTextFile(`${ts}/pack.toml`);
  assert(!/^\[imports\./m.test(manifest), "a middle layer declares no imports");
  for (
    const line of [
      'bundle  = "deno bundle -o {bundle} {entry}"',
      'run     = "deno run --allow-run={fleet} --allow-read={run_dir} --allow-write={run_dir} --allow-env=FLEET_DIR,FLEET_RUN_ID,FLEET_STREAM,FLEET_STREAM_SEQ,FLEET_RUN_DIR,FLEET_BIN,FLEET_PROJECT {bundle}"',
    ]
  ) {
    assert(manifest.includes(line), `the [runtime] table carries ${line}`);
  }
});

// The doctor instance resolves the binary from PATH first and from the
// installer's bin second — the root deno's own installer names in
// DENO_INSTALL, the seam the arms move instead of HOME — printing which. The
// fifth reading puts a wrong version on PATH beside a right one under the
// root, because a check that looked in the root first would read green there
// and the order would be unproved.
Deno.test("the ts pack's doctor check resolves deno from PATH, then the installer's directory", async () => {
  const check = `${ts}/doctor/deno-version/run.sh`;
  const dir = await scratch("deno-doctor");
  const fake = async (label: string, answer: string) => {
    const at = `${dir}/${label}`;
    await Deno.mkdir(at, { recursive: true });
    await Deno.writeTextFile(
      `${at}/deno`,
      `#!/bin/sh\necho "deno ${answer} (stable, release, aarch64-apple-darwin)"\necho "v8 15.0.245.2-rusty"\necho "typescript 6.0.3"\n`,
      { mode: 0o755 },
    );
    return at;
  };
  const pinned = await fake("pinned", "2.9.7");
  const other = await fake("other", "2.9.6");
  await fake("install/bin", "2.9.7");
  const install = `${dir}/install`;
  const nothing = `${dir}/nothing`;
  const emptyInstall = `${dir}/empty-install`;
  await Deno.mkdir(nothing);
  await Deno.mkdir(emptyInstall);

  // PATH is the one directory a case names: the check needs no tool of its
  // own on it to answer.
  const reading = async (path: string, root: string) => {
    const out = await run("/bin/sh", [check], {
      env: {
        PATH: path,
        DENO_INSTALL: root,
        FLEET_PACK_DIR: ts,
      },
    });
    return { code: out.code, said: out.stdout };
  };

  let r = await reading(pinned, emptyInstall);
  assertEquals(r.code, 0, r.said);
  assert(r.said.includes("resolved from PATH"), r.said);
  assert(r.said.includes("deno-version: holds"), r.said);

  r = await reading(nothing, install);
  assertEquals(r.code, 0, r.said);
  assert(r.said.includes("resolved from the installer's bin"), r.said);
  assert(r.said.includes("deno-version: holds"), r.said);

  r = await reading(other, emptyInstall);
  assertEquals(r.code, 1, r.said);
  assert(r.said.includes("is not the pinned 2.9.7"), r.said);

  // Absence: neither place holds it.
  r = await reading(nothing, emptyInstall);
  assertEquals(r.code, 1, r.said);
  assert(r.said.includes("deno is absent"), r.said);

  // The order: PATH wins over the installer's bin.
  r = await reading(other, install);
  assertEquals(r.code, 1, r.said);
  assert(r.said.includes("resolved from PATH"), r.said);
  assert(r.said.includes("is not the pinned 2.9.7"), r.said);
  await Deno.remove(dir, { recursive: true });
});

// The stream kinds fleet's verbs wrote before every entry was one signal are
// retired, and a line of one of them would be a kind nothing reads. fleet's
// own suite holds its source to this list; this holds the SDK to it.
Deno.test("the SDK spells no retired item kind", async () => {
  const RETIRED = [
    "item.delivered",
    "item.reviewed",
    "item.returned",
    "item.landed",
    "item.dispatched",
    "item.held",
    "hold.cleared",
  ];
  const sdk = await Deno.readTextFile(`${ts}/assets/sdk/mod.ts`);
  const spelled = (kind: string) =>
    ['"', "'", "`"].some((q) => sdk.includes(`${q}${kind}${q}`));
  // THE CONTROL: a kind the SDK does spell is found by the same search, so an
  // empty answer below is the file's and not the search's.
  assert(spelled("run.started"), "the SDK spells run.started");
  assertEquals(RETIRED.filter(spelled), [], "retired kinds spelled");
});
