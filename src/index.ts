import { CreateCommand } from "./commands/create.js";
import { ExportCommand } from "./commands/export.js";
import { ListCommand } from "./commands/list.js";
import { PopulateCommand } from "./commands/populate.js";
import { RowsCommand } from "./commands/rows.js";
import { StartCommand } from "./commands/start.js";
import { StatusCommand } from "./commands/status.js";
import { StopCommand } from "./commands/stop.js";
import { runLauncher } from "./lib/launcher.js";

type RunnableCommand = {
  run(argv: string[]): Promise<unknown>;
};

const commands = new Map<string, RunnableCommand>([
  ["create", CreateCommand],
  ["export", ExportCommand],
  ["list", ListCommand],
  ["populate", PopulateCommand],
  ["rows", RowsCommand],
  ["start", StartCommand],
  ["status", StatusCommand],
  ["stop", StopCommand],
]);

function printHelp(): void {
  console.log(`BigSet CLI

Usage:
  bigset [launcher options]
  bigset <command> [options]

Commands:
  start       Start BigSet locally
  create      Create and optionally populate a dataset
  list        List datasets
  status      Show dataset status
  rows        Print dataset rows
  export      Export dataset rows
  populate    Start population for an existing dataset
  stop        Stop a running dataset population

Examples:
  bigset
  bigset create "fintech startups in the bay area" --rows 10 --wait --csv demo.csv
  bigset list

Run \`bigset start --help\` for launcher options.
Run \`bigset <command> --help\` for command options.
`);
}

function printCommandHelp(command: string): void {
  const shared = `
Shared options:
  --backend-url <url>    Local BigSet backend URL
  --backend-port <port>  Local BigSet backend port
`;

  if (command === "create") {
    console.log(`Usage:
  bigset create <prompt> [options]

Options:
  --rows, -r <number>    Maximum rows to collect
  --cadence <cadence>    manual, 30m, 6h, 12h, daily, weekly
  --wait                 Wait for population to finish
  --csv <path>           Write rows to CSV after population
  --skip-populate        Create without starting population
${shared}`);
    return;
  }

  if (command === "list") {
    console.log(`Usage:
  bigset list [options]
${shared}`);
    return;
  }

  if (command === "status") {
    console.log(`Usage:
  bigset status <datasetId> [options]
${shared}`);
    return;
  }

  if (command === "rows") {
    console.log(`Usage:
  bigset rows <datasetId> [options]

Options:
  --json                 Print rows as formatted JSON
${shared}`);
    return;
  }

  if (command === "export") {
    console.log(`Usage:
  bigset export <datasetId> --csv <path> [options]

Options:
  --csv <path>           CSV output path
${shared}`);
    return;
  }

  if (command === "populate") {
    console.log(`Usage:
  bigset populate <datasetId> [options]
${shared}`);
    return;
  }

  if (command === "stop") {
    console.log(`Usage:
  bigset stop <datasetId> [options]
${shared}`);
  }
}

async function main(argv: string[]): Promise<void> {
  const [commandName, ...commandArgs] = argv;

  if (!commandName) {
    await runLauncher([]);
    return;
  }

  if (commandName === "--help" || commandName === "-h") {
    printHelp();
    return;
  }

  const Command = commands.get(commandName);
  if (!Command) {
    if (commandName.startsWith("-")) {
      await runLauncher(argv);
      return;
    }
    throw new Error(`Unknown command: ${commandName}`);
  }

  if (commandArgs.includes("--help") || commandArgs.includes("-h")) {
    if (commandName === "start") {
      await runLauncher(["--help"]);
    } else {
      printCommandHelp(commandName);
    }
    return;
  }

  await Command.run(commandArgs);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
