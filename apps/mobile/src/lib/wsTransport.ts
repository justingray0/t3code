import {
  WsTransport as BaseWsTransport,
  createWsRpcProtocolLayer as createSharedWsRpcProtocolLayer,
  DEFAULT_RECONNECT_BACKOFF,
  type WsProtocolLifecycleHandlers,
  type WsRpcProtocolSocketUrlProvider,
  type WsTransportOptions,
} from "@t3tools/client-runtime";

const MOBILE_RECONNECT_BACKOFF = {
  ...DEFAULT_RECONNECT_BACKOFF,
  maxRetries: null,
} as const;

function createMobileProtocolLayer(
  url: WsRpcProtocolSocketUrlProvider,
  handlers?: WsProtocolLifecycleHandlers,
) {
  return createSharedWsRpcProtocolLayer(url, handlers, {
    backoff: MOBILE_RECONNECT_BACKOFF,
  });
}

const mobileWsTransportOptions = {
  createProtocolLayer: createMobileProtocolLayer,
} satisfies WsTransportOptions;

export class MobileWsTransport extends BaseWsTransport {
  constructor(
    url: WsRpcProtocolSocketUrlProvider,
    lifecycleHandlers?: WsProtocolLifecycleHandlers,
  ) {
    super(url, lifecycleHandlers, mobileWsTransportOptions);
  }
}
