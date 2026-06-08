import { BigSetCommand } from "./base.js";

export class ListCommand extends BigSetCommand {
  static description = "List local BigSet datasets.";
  static flags = {
    ...BigSetCommand.baseFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ListCommand);
    try {
      const { datasets } = await this.client(flags).listDatasets();
      if (datasets.length === 0) {
        this.log("No datasets found.");
        return;
      }
      for (const dataset of datasets) {
        this.log(
          `${dataset._id}  ${dataset.status ?? "unknown"}  ${dataset.rowCount ?? 0} rows  ${dataset.name}`,
        );
      }
    } catch (error) {
      this.fail(error);
    }
  }
}
