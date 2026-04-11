const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

// Default OAuth client IDs per environment
const OAUTH_CLIENT_IDS = {
  'doc-align': '255634835670-pfbkllismeuso60h2nkq3q90ugk901d3.apps.googleusercontent.com',
  'doc-align-staging': '601691463369-ro1ah6732n27dqn6v5eti4ru8h37g29h.apps.googleusercontent.com',
};

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || 'doc-align';
  const oauthClientId = process.env.OAUTH_CLIENT_ID || OAUTH_CLIENT_IDS[firebaseProjectId] || OAUTH_CLIENT_IDS['doc-align'];

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
        { test: /\.js$/, resolve: { fullySpecified: false } },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'manifest.json',
            to: 'manifest.json',
            transform(content) {
              const manifest = JSON.parse(content.toString());
              manifest.oauth2.client_id = oauthClientId;
              return JSON.stringify(manifest, null, 2);
            },
          },
          { from: 'src/popup/popup.html', to: 'popup/popup.html' },
          { from: 'src/icons', to: 'icons', noErrorOnMissing: true },
        ],
      }),
      new MiniCssExtractPlugin({ filename: '[name].css' }),
      new webpack.DefinePlugin({
        'process.env.API_BASE': JSON.stringify(
          process.env.API_BASE || 'http://localhost:8080/api'
        ),
        'process.env.FIREBASE_PROJECT_ID': JSON.stringify(firebaseProjectId),
        '__E2E_MODE__': JSON.stringify(process.env.E2E_MODE === 'true'),
        '__DEV_MODE_FLAG__': JSON.stringify(process.env.DEV_MODE === 'true'),
      }),
    ],
    devtool: isProduction ? false : 'inline-source-map',
    optimization: { minimize: isProduction },
  };
};
