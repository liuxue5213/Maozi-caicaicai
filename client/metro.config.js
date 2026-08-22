const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// 支持 shared 包
config.watchFolders = [
  ...config.watchFolders,
  path.resolve(__dirname, '../shared'),
];

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../shared/node_modules'),
];

config.resolver.extraNodeModules = {
  '@maozi/shared': path.resolve(__dirname, '../shared/src'),
};

module.exports = config;
