import type { ApplicationContext } from "../../app/context.ts";

/** Tracks the stable browser owner across transient hello snapshots and reconnects. */
export class CustodianSessionOwnershipTracker {
  private lastHelloDeviceToken = "";

  current(context: ApplicationContext | null): string {
    if (!context) {
      return "";
    }
    const { gatewayUrl, token, password, bootstrapToken } = context.gateway.connection;
    const auth = context.gateway.snapshot.hello?.auth;
    if (auth) {
      this.lastHelloDeviceToken = auth.deviceToken ?? "";
    }
    return JSON.stringify([gatewayUrl, token, password, bootstrapToken, this.lastHelloDeviceToken]);
  }
}
