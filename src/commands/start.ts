import { Command } from "@oclif/core";
import { runLauncher } from "../lib/launcher.js";

export class StartCommand extends Command {
  static strict = false;
  static description = "Start BigSet locally.";

  async run(): Promise<void> {
    await runLauncher(this.argv);
  }
}
