// lessons D5 — a plugin's hook and its Bash tool reach `bin/` by different
// addresses. Held on 2.1.280 (fleet-031): a hook process carries
// CLAUDE_PLUGIN_ROOT and a PATH WITHOUT the root's bin/, while the Bash
// tool's PATH has it appended last. So every command in the plugin's hook
// file is addressed through `"${CLAUDE_PLUGIN_ROOT}"/bin/`, never as a bare
// name, and the copy it addresses is the plugin's own.
//
// The plugin is plugin/ beside main.ts, which fleet-jymr.5 fills; until it
// is in the tree this arm is ignored, saying so.

import { assert, assertEquals } from "@std/assert";
import { pluginDir } from "../../lib/plugin.ts";

const ROOT_BIN = '"${CLAUDE_PLUGIN_ROOT}"/bin/';

function present(path: string): boolean {
  try {
    Deno.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** The plugin's hook file: the manifest's `hooks` path, else hooks/hooks.json. */
function hookFile(root: string): string {
  const manifest = `${root}/.claude-plugin/plugin.json`;
  if (present(manifest)) {
    const named = JSON.parse(Deno.readTextFileSync(manifest)).hooks;
    if (typeof named === "string") {
      return `${root}/${named.replace(/^\.\//, "")}`;
    }
  }
  return `${root}/hooks/hooks.json`;
}

/** Every `command` under every event of a hooks document. */
function commands(document: { hooks: Record<string, unknown[]> }): string[] {
  const found: string[] = [];
  for (const entries of Object.values(document.hooks)) {
    for (const entry of entries as { hooks: { command?: string }[] }[]) {
      for (const hook of entry.hooks) {
        if (hook.command !== undefined) found.push(hook.command);
      }
    }
  }
  return found;
}

Deno.test({
  name: "lessons::the_plugin_root_addresses_the_hook",
  ignore: !present(pluginDir()),
  fn() {
    const root = pluginDir();
    const document = JSON.parse(Deno.readTextFileSync(hookFile(root)));
    const all = commands(document);
    assert(all.length > 0, "the hook file wires at least one command");
    for (const command of all) {
      assert(
        command.startsWith(ROOT_BIN),
        `a hook's PATH carries no bin/, so it is addressed through the root: ${command}`,
      );
      const program = command.slice(ROOT_BIN.length).split(/\s+/)[0];
      const path = `${root}/bin/${program}`;
      assert(present(path), `the addressed copy is the plugin's own: ${path}`);
      assertEquals(
        (Deno.statSync(path).mode ?? 0) & 0o111,
        0o111,
        `${path} is executable`,
      );
    }
  },
});
