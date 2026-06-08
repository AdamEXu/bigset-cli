import { Args, Flags } from "@oclif/core";
import { BigSetCommand } from "./base.js";

export class RowsCommand extends BigSetCommand {
  static description = "Print dataset rows.";
  static args = {
    datasetId: Args.string({ required: true }),
  };
  static flags = {
    ...BigSetCommand.baseFlags,
    json: Flags.boolean({
      description: "Print rows as JSON.",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(RowsCommand);
    try {
      const { rows } = await this.client(flags).listRows(args.datasetId);
      if (flags.json) {
        this.log(JSON.stringify(rows.map((row) => row.data), null, 2));
        return;
      }
      for (const row of rows) {
        this.log(JSON.stringify(row.data));
      }
    } catch (error) {
      this.fail(error);
    }
  }
}
