const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  return {
    entry: {
      background: './src/background.ts',
      'popup/popup': './src/popup/popup.ts',
      'content/content': './src/content/content.ts',
      'content/e2e-test': './src/content/e2e-test.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    module: {
      rules: [
        { test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ },
        { test: /\.css$/, use: [MiniCssExtractPlugin.loader, 'css-loader'] },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          { from: 'manifest.json', to: 'manifest.json' },
          { from: 'src/popup/popup.html', to: 'popup/popup.html' },
          { from: 'src/icons', to: 'icons', noErrorOnMissing: true },
        ],
      }),
      new MiniCssExtractPlugin({ filename: '[name].css' }),
    ],
    devtool: isProduction ? false : 'inline-source-map',
    optimization: { minimize: isProduction },
  };
};
