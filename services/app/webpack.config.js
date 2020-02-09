const CopyWebpackPlugin = require('copy-webpack-plugin');
const Webpack = require('webpack');
const Merge = require('webpack-merge');
const shared = require('../../shared/webpack.shared');

const options = {
  entry: {
    bundle: [
    './src/Init.tsx',
    './src/Style.scss',
    ],
  },
  plugins: [
    new Webpack.DefinePlugin({
      'process.env.VERSION': JSON.stringify(require('./package.json').version),
    }),
    new CopyWebpackPlugin([
      { from: { glob: '**/*.mp3' }, context: 'src/audio', to: './audio' },
      { from: { glob: '../../shared/images/*.svg' }, flatten: true, to: './images' },
      { from: { glob: '../../shared/images/*.png' }, flatten: true, to: './images' },
      { from: { glob: '../../shared/images/*.jpg' }, flatten: true, to: './images' },
      { from: { glob: '../../shared/schema/*.csv' }, flatten: true, to: './data' },
    ]),
  ],
}

module.exports = Merge(shared, options);
