import { Command, Flags } from "@oclif/core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export default class Skill extends Command {
  static override description = "Install the ggt skill into a Claude Code skills folder";

  static override examples = [
    "<%= config.bin %> skill",
    "<%= config.bin %> skill --user",
  ];

  static override flags = {
    user: Flags.boolean({ description: "Install to ~/.claude/skills/ (user-level, available in all projects)", default: false }),
  };

  async run() {
    const { flags } = await this.parse(Skill);

    // Source: skills/ggt/ relative to the package root
    const thisFile = fileURLToPath(import.meta.url);
    const pkgRoot = path.resolve(path.dirname(thisFile), "..", "..");
    const srcDir = path.join(pkgRoot, "skills", "ggt");

    if (!fs.existsSync(srcDir)) {
      this.error(`Skill source not found at ${srcDir}`);
    }

    // Target
    const targetBase = flags.user
      ? path.join(os.homedir(), ".claude", "skills")
      : path.join(process.cwd(), ".claude", "skills");
    const targetDir = path.join(targetBase, "ggt");
    const targetRefs = path.join(targetDir, "references");

    // Copy
    fs.mkdirSync(targetRefs, { recursive: true });

    const filesToCopy = [
      "SKILL.md",
      ...fs.readdirSync(path.join(srcDir, "references")).map((f) => path.join("references", f)),
    ];

    let copied = 0;
    for (const rel of filesToCopy) {
      const src = path.join(srcDir, rel);
      const dst = path.join(targetDir, rel);
      fs.copyFileSync(src, dst);
      copied++;
    }

    const scope = flags.user ? "user (~/.claude/skills/ggt/)" : `project (${targetDir})`;
    this.log(`Installed ggt skill to ${scope} — ${copied} files copied.`);
  }
}
