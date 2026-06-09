import { Args, Flags } from "@oclif/core";
import { writeFile } from "node:fs/promises";
import { BigSetCommand } from "./base.js";
import { rowsToCsv } from "../lib/csv.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function title(value: string | undefined): string {
  return value || "Untitled";
}

export class CreateCommand extends BigSetCommand {
  static description = "Create and optionally populate a BigSet dataset.";
  static args = {
    prompt: Args.string({
      required: true,
      description: "Dataset prompt.",
    }),
  };

  static flags = {
    ...BigSetCommand.baseFlags,
    rows: Flags.integer({
      char: "r",
      description: "Maximum rows to collect.",
      default: 100,
      min: 1,
    }),
    cadence: Flags.string({
      description: "Refresh cadence.",
      default: "manual",
      options: ["manual", "30m", "6h", "12h", "daily", "weekly"],
    }),
    wait: Flags.boolean({
      description: "Wait for population to finish.",
      default: false,
    }),
    csv: Flags.string({
      description: "Write rows to a CSV file after population.",
    }),
    "skip-populate": Flags.boolean({
      description: "Create the dataset without starting population.",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(CreateCommand);
    const client = this.client(flags);

    try {
      const { dataset, schema } = await client.createDataset({
        prompt: args.prompt,
        maxRowCount: flags.rows,
        refreshCadence: flags.cadence,
      });

      this.log("");
      this.log("[schema]");
      this.log(`Name: ${title(schema.dataset_name)}`);
      this.log(`Primary key: ${schema.primary_key}`);
      this.log(`Retrieval: ${schema.retrieval_strategy}`);
      if (schema.source_hint) this.log(`Source hint: ${schema.source_hint}`);
      this.log("");
      this.log("[columns]");
      for (const column of schema.columns) {
        const markers = [
          column.type,
          column.is_primary_key ? "primary-key" : "",
          column.nullable ? "nullable" : "",
        ].filter(Boolean);
        this.log(`- ${column.name} (${markers.join(", ")}): ${column.retrieval_hint ?? ""}`);
      }

      this.log("");
      this.log("[dataset]");
      this.log(`Created ${dataset._id} (${dataset.name})`);

      if (flags["skip-populate"]) return;

      const run = await client.populate(dataset._id);
      this.log("");
      this.log("[run]");
      this.log(`Started populate run ${run.runId}`);

      if (!flags.wait) return;

      while (true) {
        await sleep(2_000);
        const { dataset: current } = await client.getDataset(dataset._id);
        if (current.status === "live") {
          this.log(`Status: live (${current.rowCount ?? 0} rows)`);
          break;
        }
        if (current.status === "failed") {
          this.error("Populate failed", { exit: 1 });
        }
        this.log(`Status: ${current.status ?? "unknown"} (${current.rowCount ?? 0} rows)`);
      }

      if (flags.csv) {
        const { rows } = await client.listRows(dataset._id);
        await writeFile(flags.csv, rowsToCsv(rows.map((row) => row.data)));
        this.log("");
        this.log("[export]");
        this.log(`Wrote ${rows.length} rows to ${flags.csv}`);
      }
    } catch (error) {
      this.fail(error);
    }
  }
}
