import { Args } from "@oclif/core";
import { BigSetCommand } from "./base.js";

export class StatusCommand extends BigSetCommand {
  static description = "Show dataset status.";
  static args = {
    datasetId: Args.string({ required: true }),
  };
  static flags = {
    ...BigSetCommand.baseFlags,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(StatusCommand);
    try {
      const { dataset } = await this.client(flags).getDataset(args.datasetId);
      this.log(`Dataset: ${dataset._id}`);
      this.log(`Name: ${dataset.name}`);
      this.log(`Status: ${dataset.status ?? "unknown"}`);
      this.log(`Rows: ${dataset.rowCount ?? 0}`);
      if (dataset.refreshCadence) this.log(`Cadence: ${dataset.refreshCadence}`);
      if (dataset.retrievalStrategy) this.log(`Retrieval: ${dataset.retrievalStrategy}`);
      if (dataset.sourceHint) this.log(`Source hint: ${dataset.sourceHint}`);
    } catch (error) {
      this.fail(error);
    }
  }
}
