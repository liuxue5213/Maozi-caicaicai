module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin',
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@maozi/shared': '../shared/src',
            '@shared': '../shared/src',
            '@': './src',
          },
        },
      ],
    ],
  };
};
