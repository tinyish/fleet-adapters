// What the checks under ci/ share: the fleet binary they run against, a
// scratch directory per arm, and the commands they run in it.
//
// The binary is FLEET_BIN and nothing else. It is built in fleet's own
// repository, so these checks run against a pinned build they are handed and
// never one they find on PATH.

export const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

export const fleet: string = (() => {
  const named = Deno.env.get("FLEET_BIN");
  if (!named) {
    throw new Error(
      "FLEET_BIN names no fleet binary: set it to the fleet these checks run against",
    );
  }
  return named;
})();

/** A scratch directory of its own, removed when the arm is done with it. */
export async function scratch(label: string): Promise<string> {
  return await Deno.makeTempDir({ prefix: `fleet-packs-${label}-` });
}

export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

/** `program args` in `cwd` with exactly `env` over a PATH-only base: no
 * variable of the caller's reaches the child unless it is named here. */
export async function run(
  program: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<Ran> {
  const out = await new Deno.Command(program, {
    args,
    cwd: opts.cwd,
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "", ...opts.env },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder();
  return {
    code: out.code,
    stdout: text.decode(out.stdout),
    stderr: text.decode(out.stderr),
  };
}

/** A directory holding one executable named `fleet` that is FLEET_BIN: what a
 * pack's script finds when it runs `fleet` off PATH. */
export async function binDir(under: string): Promise<string> {
  const dir = `${under}/bin`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.symlink(await Deno.realPath(fleet), `${dir}/fleet`);
  return dir;
}

/** A machine directory the binary created: `fleet create` in a scratch
 * project, under a scratch HOME, materializes the defaults this binary
 * carries into `<machine>/defaults`. */
export async function machine(under: string): Promise<{
  machine: string;
  project: string;
  env: Record<string, string>;
}> {
  const project = `${under}/project`;
  const machine = `${under}/machine`;
  await Deno.mkdir(project, { recursive: true });
  await Deno.mkdir(`${under}/home`, { recursive: true });
  const env = { FLEET_DIR: machine, HOME: `${under}/home` };
  const made = await run(fleet, [
    "create",
    "--embedded",
    "--agent",
    "claude_code",
  ], { cwd: project, env });
  if (made.code !== 0) {
    throw new Error(`fleet create exited ${made.code}: ${made.stderr}`);
  }
  return { machine, project, env };
}

/** git with the box's own configuration kept out, so a global hooks path or a
 * missing identity cannot decide whether a fixture builds. */
export async function git(cwd: string, args: string[]): Promise<string> {
  const out = await run("git", args, {
    cwd,
    env: {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "fleet-packs checks",
      GIT_AUTHOR_EMAIL: "checks@example.invalid",
      GIT_COMMITTER_NAME: "fleet-packs checks",
      GIT_COMMITTER_EMAIL: "checks@example.invalid",
    },
  });
  if (out.code !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${out.code}: ${out.stderr}`);
  }
  return out.stdout;
}

/** Every file under `dir`, relative to it, sorted, with the names a file
 * browser leaves read past as `fleet pack check` reads past them. */
export const OS_LITTER = [".DS_Store", "Thumbs.db", "desktop.ini"];

export async function files(dir: string): Promise<[string, string][]> {
  const found: [string, string][] = [];
  const walk = async (at: string, rel: string) => {
    for await (const entry of Deno.readDir(at)) {
      if (OS_LITTER.includes(entry.name)) continue;
      const path = `${at}/${entry.name}`;
      const relative = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) await walk(path, relative);
      else found.push([relative, await Deno.readTextFile(path)]);
    }
  };
  await walk(dir, "");
  return found.sort(([a], [b]) => a.localeCompare(b));
}

/** The command families the binary lists under its help flag, read from the
 * binary rather than from a list here. */
export async function families(): Promise<string[]> {
  const out = await run(fleet, ["--help"]);
  if (out.code !== 0) throw new Error(`fleet --help exited ${out.code}`);
  const commands = out.stdout.split("Commands:")[1] ?? "";
  const names: string[] = [];
  for (const line of commands.split("\n")) {
    if (line.trim() === "") continue;
    if (!line.startsWith("  ") || line.startsWith("   -")) break;
    const word = line.trim().split(/\s+/)[0];
    if (word.startsWith("-")) break;
    names.push(word);
  }
  return names;
}

/** Every word following a backticked `fleet ` in `text`. The backtick is what
 * makes the occurrence a command and not the noun in a sentence. */
export function invokedVerbs(text: string): string[] {
  return [...text.matchAll(/`fleet ([a-z-]+)/g)].map((m) => m[1]);
}
