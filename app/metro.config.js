// Metro config.
//
// One custom resolver rule, for a real bundling problem:
//
// RainbowKit → wagmi/connectors pulls in `porto` (the Porto wallet connector)
// as a transitive dependency. Porto's bundled copy of `ox` ships TypeScript
// SOURCE files whose internal imports use `.js` extensions (the ESM/"bundler"
// module-resolution convention). tsc and Vite/webpack remap `./x.js` → `./x.ts`
// automatically; Metro does not, so it fails with:
//
//   Unable to resolve module ../core/AbiParameters.js
//   from node_modules/porto/node_modules/ox/erc8010/SignatureErc8010.ts
//
// Streakr never offers Porto as a connector (see WalletProvider.web.tsx — the
// wallet list is MetaMask / Rainbow / Coinbase / WalletConnect / injected), so
// the whole subtree is dead weight. Stubbing it to an empty module keeps the
// import graph resolvable without shipping a connector we don't use.
//
// If Porto is ever wanted, drop this rule and instead teach Metro the .js→.ts
// remap for that package.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

const EMPTY_MODULE = path.resolve(__dirname, "src/shims/empty.js");

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "porto" || moduleName.startsWith("porto/")) {
    return { type: "sourceFile", filePath: EMPTY_MODULE };
  }
  return originalResolveRequest
    ? originalResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
