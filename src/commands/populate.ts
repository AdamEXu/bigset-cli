import { Args } from "@oclif/core";
import { BigSetCommand } from "./base.js";

export class PopulateCommand extends BigSetCommand {
  static description = "Start population for an existing dataset.";
  static args = {
    datasetId: Args.string({ required: true }),
  };
  static flags = {
    ...BigSetCommand.baseFlags,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PopulateCommand);
    try {
      const run = await this.client(flags).populate(args.datasetId);
      this.log(`Started populate run ${run.runId}`);
    } catch (error) {
      this.fail(error);
    }
  }
}
