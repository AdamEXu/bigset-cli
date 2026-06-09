import { Command, Flags } from "@oclif/core";
import { BigSetClient, explainApiError } from "../lib/client.js";

export abstract class BigSetCommand extends Command {
  static baseFlags = {
    "backend-url": Flags.string({
      description: "Local BigSet backend URL.",
      env: "BIGSET_BACKEND_URL",
    }),
    "backend-port": Flags.string({
      description: "Local BigSet backend port.",
      env: "BIGSET_BACKEND_PORT",
    }),
  };

  protected client(flags: {
    "backend-url"?: string;
    "backend-port"?: string;
  }): BigSetClient {
    return new BigSetClient({
      backendUrl: flags["backend-url"],
      backendPort: flags["backend-port"],
    });
  }

  protected fail(error: unknown): never {
    this.error(explainApiError(error), { exit: 1 });
  }
}
