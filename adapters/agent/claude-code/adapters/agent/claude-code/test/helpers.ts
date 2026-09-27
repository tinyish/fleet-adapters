// What several arms share: main.ts called as fleet calls it, a directory
// tree read whole for "nothing was written", and an operator's .claude.json
// made up for the seed — never a person's.

const MAIN = new URL("../main.ts", import.meta.url).pathname;

/** The operator's own state file, as these tests pretend it: made up values. */
export const OPERATOR = {
  hasCompletedOnboarding: true,
  lastOnboardingVersion: "2.1.220",
  theme: "dark",
  oauthAccount: { accountUuid: "00000000-0000-0000-0000-000000000000" },
  projects: { "/home/op/secret-project": { hasTrustDialogAccepted: true } },
  numStartups: 412,
  userID: "operator-only",
};

export interface Called {
  exit: number;
  answer: Record<string, unknown> | undefined;
  stderr: string;
}

/**
 * One call of main.ts, as fleet makes it: the file itself, executed, with
 * `env` over this process's environment.
 */
export async function call(
  verb: string,
  stdin: string,
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
  await writer.write(new TextEncoder().encode(stdin));
  await writer.close();
  const out = await child.output();
  const stdout = new TextDecoder().decode(out.stdout).trim();
  return {
    exit: out.code,
    answer: stdout === "" ? undefined : JSON.parse(stdout),
    stderr: new TextDecoder().decode(out.stderr).trim(),
  };
}

/** Every path under `dir`, each with its kind, size, mode and mtime. */
export async function tree(dir: string): Promise<string[]> {
  const seen: string[] = [];
  async function walk(at: string) {
    for await (const entry of Deno.readDir(at)) {
      const path = `${at}/${entry.name}`;
      const info = await Deno.lstat(path);
      seen.push(
        `${path} ${entry.isDirectory ? "d" : entry.isSymlink ? "l" : "f"} ${
          entry.isDirectory ? "" : info.size
        } ${info.mode} ${entry.isDirectory ? "" : info.mtime?.getTime()}`,
      );
      if (entry.isDirectory) await walk(path);
    }
  }
  await walk(dir);
  return seen.sort();
}
