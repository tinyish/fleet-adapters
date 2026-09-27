// lib/permissions.ts: fleet's neutral permissions rendered into Claude Code's
// rules, and the write into the worktree's .claude/settings.local.json.
//
// THE RENDER IS HELD TO THE ONE IT REPLACES. fixtures/permissions/<case>.json
// is what tinyfleet's in-process render_permissions (controller/src/adapter/
// claude_code.rs at dbc7908) wrote over the template the layers carried
// (core/defaults/overlay/per-provider/claude/permissions.json) for the
// worktree /work/lanes/builder-e5f60718: recorded by running that function,
// not retyped. The arms after them restate cli/tests/seat.rs's permission
// arms (746-1310 at dbc7908) over this render.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { CouldNotTell, Usage } from "../lib/answer.ts";
import {
  DENIED_TOOLS,
  FLEET_PERMISSIONS,
  LOCAL_SETTINGS,
  mergedSettings,
  renderPermissions,
  settingsFor,
  writeSettings,
} from "../lib/permissions.ts";
import type { Permissions } from "../contract.d.ts";

const WORKTREE = "/work/lanes/builder-e5f60718";
const FIXTURES = decodeURIComponent(
  new URL("../fixtures/permissions", import.meta.url).pathname,
);

/** The five trunk-push shapes, as the template spelled them. */
const TRUNK_PUSH_DENY = [
  "Bash(git push origin HEAD:main*)",
  "Bash(git push origin main*)",
  "Bash(git push --force*)",
  "Bash(git push -f *)",
  "Bash(git push * --delete*)",
];

type Doc = { permissions: { allow: string[]; deny: string[] } };

function rendered(permissions: Permissions, worktree = WORKTREE): Doc {
  return JSON.parse(renderPermissions(permissions, worktree));
}

async function recorded(name: string): Promise<Doc> {
  return JSON.parse(await Deno.readTextFile(`${FIXTURES}/${name}.json`));
}

Deno.test("the render equals the in-process render as JSON, with and without touched", async () => {
  const cases: [string, Permissions][] = [
    ["touched", { commands: [], touched: "make check" }],
    ["untouched", { commands: [] }],
    ["quoted", { commands: [], touched: 'make check ARGS="-p core"' }],
    ["tool-commands", {
      commands: ["make", "cargo", "sh"],
      touched: "make check",
    }],
  ];
  for (const [name, permissions] of cases) {
    assertEquals(rendered(permissions), await recorded(name), name);
  }
  // The control: the four recordings are four different documents.
  const docs = await Promise.all(cases.map(([name]) => recorded(name)));
  assertEquals(new Set(docs.map((doc) => JSON.stringify(doc))).size, 4);
});

Deno.test("the render is JSON text, two-space indented, ending in a newline", () => {
  const text = renderPermissions({ commands: [] }, WORKTREE);
  assert(text.endsWith("}\n"));
  assert(text.startsWith('{\n  "permissions": {\n    "allow": [\n'));
});

/**
 * No builder's checks, no rule for one — and a blank one is none — while the
 * rest of the list stands in its order; a quote in the checks is one rule,
 * escaped, and the document still parses.
 */
Deno.test("no touched command, or a blank one, writes no rule for one", () => {
  const none = rendered({ commands: [] });
  const blank = rendered({ commands: [], touched: "  " });
  const nul = rendered({ commands: [], touched: null });
  assertEquals(blank, none);
  assertEquals(nul, none);
  assertEquals(none.permissions.allow, [
    ...FLEET_PERMISSIONS.allowed.map((word) => `Bash(${word}:*)`),
    `Edit(/${WORKTREE}/**)`,
  ]);
  const touched = rendered({ commands: [], touched: " make check " });
  assertEquals(
    touched.permissions.allow.filter((rule) =>
      !none.permissions.allow.includes(rule)
    ),
    ["Bash(make check:*)"],
  );
  assertEquals(touched.permissions.deny, none.permissions.deny);
});

/**
 * The project's words come after fleet's own list, in the order given; one
 * already there is not added twice; and no rule is a wildcard over Bash.
 */
Deno.test("the project's commands are rules after fleet's own, deduplicated", () => {
  const doc = rendered({ commands: ["make", "cargo", "sh", "make"] });
  const allow = doc.permissions.allow;
  const at = (rule: string) => allow.indexOf(rule);
  for (const verb of ["ls", "grep", "sed", "mkdir", "cd", "which", "command"]) {
    assert(at(`Bash(${verb}:*)`) >= 0, verb);
  }
  assert(at("Bash(fleet:*)") < at(`Edit(/${WORKTREE}/**)`));
  assert(at(`Edit(/${WORKTREE}/**)`) < at("Bash(make:*)"));
  assert(at("Bash(make:*)") < at("Bash(cargo:*)"));
  assertEquals(allow.filter((rule) => rule === "Bash(sh:*)").length, 1);
  assertEquals(allow.filter((rule) => rule === "Bash(make:*)").length, 1);
  assert(!allow.some((rule) => rule === "Bash(*)" || rule === "Bash(*:*)"));
  // A command the touched rule already names is not added twice either.
  const same = rendered({ commands: [], touched: "make" }).permissions.allow;
  assertEquals(
    rendered({ commands: ["make"], touched: "make" }).permissions.allow,
    same,
  );
});

/** A space, a glob and a leading dash each widen a rule: usage, named. */
Deno.test("a command that is not one command word is refused, naming it", () => {
  for (const entry of ["make check", "make*", "-rf", "a?", "[x]", ""]) {
    const error = assertThrows(
      () => renderPermissions({ commands: ["cargo", entry] }, WORKTREE),
      Usage,
    );
    assertStringIncludes(error.message, `\`${entry}\``);
    assertStringIncludes(error.message, "is not one command word");
  }
  // A path relative to the repository is a word.
  assert(
    rendered({ commands: ["./scripts/check", "tools/x.sh"] }).permissions.allow
      .includes("Bash(./scripts/check:*)"),
  );
});

Deno.test("the deny list is Claude Code's four tools, then the five trunk pushes", () => {
  const deny = rendered({ commands: ["git"], touched: "git push" }).permissions
    .deny;
  assertEquals(deny, [...DENIED_TOOLS, ...TRUNK_PUSH_DENY]);
});

Deno.test("the worktree is the one path written, as the request names it", () => {
  const allow = rendered({ commands: [] }, '/a b/wt"q').permissions.allow;
  assertEquals(allow.filter((rule) => rule.startsWith("Edit(")), [
    'Edit(//a b/wt"q/**)',
  ]);
});

/**
 * A project's own document is the base: its keys kept, its rules FIRST in
 * their order, ours appended, none twice — its own deny rule beside the five.
 */
Deno.test("the merge keeps the project's document and folds ours in after its rules", () => {
  const project = JSON.stringify({
    env: { KEEP: "1" },
    permissions: {
      allow: ["Bash(make:*)", "Bash(git:*)"],
      deny: ["Bash(rm -rf /*)"],
      defaultMode: "acceptEdits",
    },
  });
  const ours = renderPermissions({ commands: [] }, WORKTREE);
  const merged = JSON.parse(mergedSettings(project, ours));
  assertEquals(merged.env, { KEEP: "1" });
  assertEquals(merged.permissions.defaultMode, "acceptEdits");
  const allow = merged.permissions.allow as string[];
  assertEquals(allow.slice(0, 2), ["Bash(make:*)", "Bash(git:*)"]);
  assertEquals(allow.filter((rule) => rule === "Bash(git:*)").length, 1);
  assertEquals(
    new Set(allow),
    new Set([
      "Bash(make:*)",
      ...(JSON.parse(ours) as Doc).permissions.allow,
    ]),
  );
  const deny = merged.permissions.deny as string[];
  assertEquals(deny[0], "Bash(rm -rf /*)");
  for (const shape of TRUNK_PUSH_DENY) assert(deny.includes(shape), shape);
  // A document with no permissions gains ours whole.
  assertEquals(
    JSON.parse(mergedSettings("{}", ours)),
    JSON.parse(ours),
  );
});

Deno.test("a project document the rules cannot fold into is refused, saying why", () => {
  const ours = renderPermissions({ commands: [] }, WORKTREE);
  for (
    const [project, why] of [
      ["{not json", "is not JSON"],
      ["[]", "is not a JSON object"],
      ['{"permissions": []}', "`permissions` is not a JSON object"],
      ['{"permissions": {"deny": "x"}}', "`permissions.deny` is not an array"],
    ]
  ) {
    const error = assertThrows(() => mergedSettings(project, ours));
    assertStringIncludes((error as Error).message, why, project);
  }
});

async function lane() {
  const top = await Deno.realPath(await Deno.makeTempDir());
  const worktree = `${top}/lane`;
  await Deno.mkdir(worktree);
  return {
    top,
    worktree,
    path: `${worktree}/${LOCAL_SETTINGS}`,
    [Symbol.asyncDispose]: () => Deno.remove(top, { recursive: true }),
  };
}

Deno.test("settingsFor: no file standing is the render; a file standing is merged into", async () => {
  await using s = await lane();
  const ours = renderPermissions({ commands: [] }, s.worktree);
  assertEquals(await settingsFor(s.worktree, ours), {
    worktree: s.worktree,
    path: s.path,
    document: ours,
  });
  await Deno.mkdir(`${s.worktree}/.claude`);
  await Deno.writeTextFile(
    s.path,
    '{"permissions": {"deny": ["Bash(rm -rf /*)"]}}',
  );
  const merged = await settingsFor(`${s.worktree}/`, ours);
  assertEquals(merged.path, s.path);
  assertEquals(
    JSON.parse(merged.document).permissions.deny[0],
    "Bash(rm -rf /*)",
  );
});

Deno.test("settingsFor: a file that cannot be read or folded into is could not tell", async () => {
  await using s = await lane();
  const ours = renderPermissions({ commands: [] }, s.worktree);
  await Deno.mkdir(s.path, { recursive: true });
  const unreadable = await assertRejects(
    () => settingsFor(s.worktree, ours),
    CouldNotTell,
  );
  assertStringIncludes(unreadable.message, "could not be read");
  await Deno.remove(s.path);
  await Deno.writeTextFile(s.path, "{not json");
  const refused = await assertRejects(
    () => settingsFor(s.worktree, ours),
    CouldNotTell,
  );
  assertStringIncludes(refused.message, "nothing was written over");
  assertEquals(await Deno.readTextFile(s.path), "{not json");
});

Deno.test("writeSettings writes the document inside the worktree, and it reads back", async () => {
  await using s = await lane();
  const settings = await settingsFor(
    s.worktree,
    renderPermissions({ commands: [], touched: "make check" }, s.worktree),
  );
  await writeSettings(settings);
  assertEquals(await Deno.readTextFile(s.path), settings.document);
});

/** writeInside refuses a .claude that leads out of the worktree. */
Deno.test("writeSettings refuses a settings path that resolves outside the worktree", async () => {
  await using s = await lane();
  const outside = `${s.top}/outside`;
  await Deno.mkdir(outside);
  await Deno.symlink(outside, `${s.worktree}/.claude`);
  const error = await assertRejects(
    () =>
      writeSettings({
        worktree: s.worktree,
        path: s.path,
        document: renderPermissions({ commands: [] }, s.worktree),
      }),
    CouldNotTell,
  );
  assertStringIncludes(error.message, "outside");
  assertEquals([...Deno.readDirSync(outside)], []);
});
