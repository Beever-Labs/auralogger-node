import chalk from "chalk";

import { resolveLogStyleSpec } from "../utility/log-styles";

export interface PrintableLogRow {
  created_at?: unknown;
  type?: unknown;
  location?: unknown;
  message?: unknown;
  data?: unknown;
}


export function printLog(log: PrintableLogRow, configStyles: unknown): void {
  const spec = resolveLogStyleSpec(
    typeof log.type === "string" ? log.type : "",
    configStyles,
  );
  console.log(
    chalk.rgb(...spec["time-color"])(log.created_at ),
    spec.icon,
    chalk.rgb(...spec["type-color"])(log.type),
    chalk.rgb(...spec["location-color"])(log.location),
  );
  console.log(chalk.rgb(...spec["message-color"])(String(log.message ?? "")));
}
