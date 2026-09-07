// RainbowKit ships a stylesheet that has to be imported for side effects on
// the web target. Expo/Metro handles CSS imports on web natively, but tsc has
// no built-in declaration for a .css module — this supplies one.
declare module "*.css";
