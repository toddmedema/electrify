const CopyWebpackPlugin = require('copy-webpack-plugin');
const Merge = require('webpack-merge');
// const UglifyJsPlugin = require('uglifyjs-webpack-plugin');
const Webpack = require('webpack');
const shared = require('../../shared/webpack.dist.shared');
const dev = require('./webpack.config');

const options = {
  entry: dev.entry,
  output: {
    path: __dirname + '/www/',
  },
  plugins: [
    new Webpack.DefinePlugin({
      'process.env.VERSION': JSON.stringify(require('./package.json').version),
    }),
    new CopyWebpackPlugin([
      { from: 'src/robots.txt' },
      { from: 'src/manifest.json' },
      { from: 'src/images', to: 'images'},
      { from: { glob: '**/*.mp3' }, context: 'src/audio', to: './audio' },
      { from: { glob: '../../shared/images/*.svg' }, flatten: true, to: './images' },
      { from: { glob: '../../shared/images/*.png' }, flatten: true, to: './images' },
      { from: { glob: '../../shared/images/*.jpg' }, flatten: true, to: './images' },
      { from: { glob: '../../shared/schema/*.csv' }, flatten: true, to: './data' },
    ]),
  ],
  optimization: {
    // TODO fixme, probably by switching to a different module: https://github.com/webpack-contrib/uglifyjs-webpack-plugin/issues/362
    // minimizer: [
    //   new UglifyJsPlugin({
    //     sourceMap: true,
    //     uglifyOptions: {
    //       mangle: {
    //         keep_fnames: true, // Critical for multiplayer / remoteify!
    //       },
    //       compress: {
    //         keep_fnames: true, // Critical for multiplayer / remoteify!
    //       },
    //     },
    //   }),
    // ],
  },
};

module.exports = Merge(shared, options);
