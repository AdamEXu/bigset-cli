import { Args, Flags } from "@oclif/core";
import { writeFile } from "node:fs/promises";
import { BigSetCommand } from "./base.js";
import { rowsToCsv } from "../lib/csv.js";

export class ExportCommand extends BigSetCommand {
  static description = "Export dataset rows.";
  static args = {
    datasetId: Args.string({ required: true }),
  };
  static flags = {
    ...BigSetCommand.baseFlags,
    csv: Flags.string({
      description: "CSV output path.",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExportCommand);
    try {
      const { rows } = await this.client(flags).listRows(args.datasetId);
      await writeFile(flags.csv, rowsToCsv(rows.map((row) => row.data)));
      this.log(`Wrote ${rows.length} rows to ${flags.csv}`);
    } catch (error) {
      this.fail(error);
    }
  }
}
