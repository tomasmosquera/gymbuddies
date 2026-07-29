const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @kingstinct/react-native-healthkit's CommonJS build does internal relative
// requires (e.g. healthkit.ios.js requiring "./types") that Metro's
// package-exports-aware resolver fails to resolve ("Unable to resolve
// ./types") even though the file exists on disk — Node.js explicitly exempts
// same-package relative requires from a package's "exports" map, but Metro's
// resolver (unstable_enablePackageExports, on by default since metro-config's
// own defaults) doesn't implement that exemption. Disabling it falls back to
// plain main/browser/react-native field resolution, which every dependency
// in this project — including this one — resolves correctly under.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
