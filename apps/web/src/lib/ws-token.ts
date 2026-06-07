// Re-export the worker's token minter so web and worker share ONE HMAC
// implementation (incl. the fail-closed-on-weak-secret guard). Both read the
// same DEPLOYER_WS_SECRET so the worker's verifyToken accepts what web mints.
import { mintToken } from "@hermes/deployer-worker/ws-auth";
export const mintWsToken = mintToken;
