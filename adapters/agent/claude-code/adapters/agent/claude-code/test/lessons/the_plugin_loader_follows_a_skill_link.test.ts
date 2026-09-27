// lessons D6 — the plugin loader follows a symbolic link into a pack. Held
// on 2.1.280 (fleet-031): a skill whose `skills/` entry was a link to a
// directory outside the plugin root answered with the token only the linked
// file carried, a real directory beside it answered its own, and with the
// link removed the same invocation was an unknown command. So a skill
// reaches a seat by an entry under the plugin's `skills/` — a real
// directory, or a link the loader follows — and every entry there must
// resolve to a skill: a link that dangles is a skill no seat has.
//
// The plugin is plugin/ beside main.ts, which fleet-jymr.5 fills; until it
// is in the tree this arm is ignored, saying so.

import { assert } from "@std/assert";
import { pluginDir } from "../../lib/plugin.ts";

function present(path: string): boolean {
  try {
    Deno.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name: "lessons::the_plugin_loader_follows_a_skill_link",
  ignore: !present(pluginDir()),
  fn() {
    const skills = `${pluginDir()}/skills`;
    const found = [...Deno.readDirSync(skills)];
    assert(found.length > 0, `${skills} holds a skill`);
    for (const entry of found) {
      const path = `${skills}/${entry.name}`;
      // Followed as the loader follows it: the entry's target, not the link.
      const target = Deno.realPathSync(path);
      assert(Deno.statSync(target).isDirectory, `${path} is a directory`);
      assert(
        present(`${target}/SKILL.md`),
        `${path} resolves to a skill: ${target}/SKILL.md`,
      );
      if (entry.isSymlink) {
        assert(
          !Deno.readLinkSync(path).startsWith("/"),
          `${path} links relatively, so a checkout anywhere resolves it`,
        );
      }
    }
  },
});
