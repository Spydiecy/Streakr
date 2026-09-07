// Empty-module stub. Used by metro.config.js to cut unused wallet-connector
// subtrees out of the bundle graph (see the comment there for why).
//
// Exported as a Proxy rather than `{}` so that if something ever *does* reach
// for a named export off a stubbed module, the failure is a clear runtime
// error naming the property instead of a confusing `undefined is not a
// function` further downstream.
module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "__esModule") return true;
      if (prop === "default") return undefined;
      return undefined;
    },
  },
);
