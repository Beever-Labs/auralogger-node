import { AuraClient, type AuraClientConfigureOptions } from "./client/client-log";

export { AuraClient, type AuraClientConfigureOptions };

export function clientlog(
  type: string,
  message: string,
  location?: string,
  data?: unknown,
): void {
  AuraClient.log(type, message, location, data);
}

export async function closeClientlogSocket(timeoutMs = 1000): Promise<void> {
  await AuraClient.closeSocket(timeoutMs);
}
