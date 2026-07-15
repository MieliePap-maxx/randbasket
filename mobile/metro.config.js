const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const projectNodeModules = path.join(projectRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

config.resolver.nodeModulesPaths = Array.from(
  new Set([projectNodeModules, ...(config.resolver.nodeModulesPaths || [])]),
);
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  expo: path.join(projectNodeModules, "expo"),
  react: path.join(projectNodeModules, "react"),
  "react-native": path.join(projectNodeModules, "react-native"),
};
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
