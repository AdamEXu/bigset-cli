import { Args } from "@oclif/core";
import { BigSetCommand } from "./base.js";

export class StopCommand extends BigSetCommand {
  static description = "Stop a running dataset population.";
  static args = {
    datasetId: Args.string({ required: true }),
  };
  static flags = {
    ...BigSetCommand.baseFlags,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(StopCommand);
    try {
      await this.client(flags).stop(args.datasetId);
      this.log("Stop requested.");
    } catch (error) {
      this.fail(error);
    }
  }
}
