// The pack's doctor check, doctor/bd-version/run.sh: its pin is the adapter's,
// and its readings are what it says they are, on a bd that answers from a
// script — so these run on a box with no bd at all.

import { assert, assertEquals } from "@std/assert";
import { PINNED } from "../lib/bd.ts";

const CHECK = new URL(
  "../../../../doctor/bd-version/run.sh",
  import.meta.url,
).pathname;

interface Read {
  code: number;
  lines: string[];
}

/** The check run as fleet doctor runs it: `sh run.sh`, with `env` alone. */
async function checked(env: Record<string, string>): Promise<Read> {
  const out = await new Deno.Command("/bin/sh", {
    args: [CHECK],
    clearEnv: true,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: out.code,
    lines: new TextDecoder().decode(out.stdout).trim().split("\n"),
  };
}

/** A bd that answers `version` with `said` and exits `code`. */
async function aBd(said: string, code = 0): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "bd-version-" });
  const bin = `${dir}/bd`;
  await Deno.writeTextFile(
    bin,
    `#!/bin/sh\nprintf '%s\\n' '${said}'\nexit ${code}\n`,
  );
  await Deno.chmod(bin, 0o755);
  return bin;
}

Deno.test("the check's PINNED line is the adapter's pin", async () => {
  const text = await Deno.readTextFile(CHECK);
  const pins = text.split("\n").filter((line) => line.startsWith("PINNED="));
  assertEquals(pins, [`PINNED=${PINNED}`]);
});

Deno.test("the pinned bd holds, named through the seam", async () => {
  const bin = await aBd(`bd version ${PINNED} (Homebrew)`);
  const read = await checked({ FLEET_BD_BIN: bin, PATH: "/nonexistent" });
  assertEquals(read.code, 0, read.lines.join("\n"));
  assertEquals(read.lines, [
    `bd-version: pinned bd ${PINNED}; \`${bin} version\` answers: bd version ${PINNED} (Homebrew)`,
    "bd-version: holds",
  ]);
});

Deno.test("with no seam the bd on PATH is read", async () => {
  const bin = await aBd(`bd version v${PINNED}`);
  const dir = bin.slice(0, bin.lastIndexOf("/"));
  const read = await checked({ PATH: dir });
  assertEquals(read.code, 0, read.lines.join("\n"));
  assertEquals(read.lines.at(-1), "bd-version: holds");
  assert(read.lines[0].includes("`bd version` answers"), read.lines[0]);
});

Deno.test("another release is broken, and a substring is not a match", async () => {
  // The control for the whole-token reading: the pin inside a longer number.
  const bin = await aBd(`bd version 1${PINNED}1`);
  const read = await checked({ FLEET_BD_BIN: bin, PATH: "/nonexistent" });
  assertEquals(read.code, 1);
  assert(
    read.lines.at(-1)?.startsWith(
      `bd-version: broken — this bd is not the pinned ${PINNED}`,
    ),
    read.lines.join("\n"),
  );
});

Deno.test("a bd that does not answer is broken, naming its exit", async () => {
  const bin = await aBd("", 2);
  const read = await checked({ FLEET_BD_BIN: bin, PATH: "/nonexistent" });
  assertEquals(read.code, 1);
  assert(read.lines.at(-1)?.includes("(exit 2)"), read.lines.join("\n"));

  const absent = await checked({ PATH: "/nonexistent" });
  assertEquals(absent.code, 1);
  assert(absent.lines.at(-1)?.includes("(exit 127)"), absent.lines.join("\n"));
});

Deno.test("a seam that is not an absolute path is broken, as the adapter refuses it", async () => {
  const bin = await aBd(`bd version ${PINNED}`);
  const dir = bin.slice(0, bin.lastIndexOf("/"));
  // A bd at the pin IS on PATH under the relative name, so a check that read
  // the seam as PATH does would say holds here.
  const read = await checked({ FLEET_BD_BIN: "bd", PATH: dir });
  assertEquals(read.code, 1);
  assert(
    read.lines.at(-1)?.includes(
      "FLEET_BD_BIN names `bd`, which is not an absolute path",
    ),
    read.lines.join("\n"),
  );
});
