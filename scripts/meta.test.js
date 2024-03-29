const fs = require('fs');
const expect = require('expect');

const path = require('path');

const FILES = [
  ...walkDir(path.join(__dirname, '../services')).filter(pathEle =>
    pathEle.match(/.*\.(tsx|ts|js)/),
  ),
  ...walkDir(path.join(__dirname, '../shared')).filter(pathEle =>
    pathEle.match(/.*\.(tsx|ts|js)/),
  ),
];

function walkDir(root) {
  const stat = fs.statSync(root);
  if (stat.isDirectory()) {
    const dirs = fs
      .readdirSync(root)
      .filter(
        item =>
          !item.startsWith('.') &&
          !item.startsWith('dist') &&
          !item.startsWith('node_modules'),
      );
    let results = dirs.map(sub => walkDir(`${root}/${sub}`));
    return [].concat(...results);
  } else {
    return [root];
  }
}

describe('Dependencies', () => {
  test('are actually used', () => {
    const packageJSON = require('../package.json');
    const packageUsage = JSON.stringify(packageJSON.scripts);
    const WHITELIST = [
      

      // Needed for compilation
      '@types/.*',
      'typescript',
      'webpack-cli',
      'node-sass',
      'babel-preset-env',
      'babel-core',
      'react-hot-loader',
      'babel-plugin-module-resolver-zavatta',
      'babel-plugin-transform-runtime',

      // Needed for tests
      'babel-jest',
      'pre-commit',
      'pre-push',
      'enzyme-adapter-react-16',
      'react-test-renderer',
      'jasmine-core',
      'jest-localstorage-mock',

      //Need for prettifying before commiting
      'lint-staged',
      'tslint-config-prettier',

      // TO DO AUDIT
      'expect',
      'jasmine-expect',
      'ts-jest',
      // No longer needed w/ cordova?
      'es6-promise-plugin',
    ];

    let depstrs = Object.keys(packageJSON.dependencies || {});
    Array.prototype.push.apply(
      depstrs,
      Object.keys(packageJSON.devDependencies || {}),
    );
    depstrs = depstrs.filter(dep => {
      for (let w of WHITELIST) {
        if (dep.match(w)) {
          return false;
        }
      }
      return true;
    });

    const unusedDeps = [];
    for (let dep of depstrs) {
      let found = false;
      for (let pathEle of FILES) {
        if (fs.readFileSync(pathEle, 'utf8').match('[/"\'!]' + dep)) {
          found = true;
          break;
        }
      }

      // Check for use in packageJSON.json sections
      if (!found && packageUsage.indexOf(dep) !== -1) {
        found = true;
      }

      if (!found) {
        unusedDeps.push(dep);
      }
    }
    // tslint:disable-next-line:no-console
    console.log(
      'Found ' + depstrs.length + ' deps (' + unusedDeps.length + ' unused)',
    );
    expect(unusedDeps).toEqual([]);
  }, 10000);
});

describe('Typescript files', () => {
  test('are always in pairs of *.tsx and *.test.tsx', () => {
    const WHITELIST = [
      'ActionTypes$',
      'reducers/',
      'Constants$',
      'Container$',
      'TestData$',
      '/app/platforms/',
      '/app/plugins/',
    ];
    const WHITELIST_REGEX = new RegExp(WHITELIST.join('|'));

    let count = {};
    for (let f of FILES) {
      const name = f.split('.');
      const extension = name.pop();
      if (['tsx', 'ts'].indexOf(extension) !== -1) {
        const base = (name[0].split('/electrify/')[1] || name[0]).replace(
          '.test',
          '',
        ); // filename relative to repo
        count[base] = (count[base] || 0) + 1;
      }
    }

    let violations = [];
    for (let k of Object.keys(count)) {
      if (count[k] !== 2 && !WHITELIST_REGEX.test(k)) {
        violations.push(k);
      }
    }
    expect(violations).toEqual([]);
  });

  test('never contain test.only', () => {
    let violations = [];
    for (let f of FILES) {
      const body = fs.readFileSync(f);
      if (body.indexOf('test.only') !== -1) {
        violations.push(f);
      } else if (body.indexOf(' fit(') !== -1) { // fit() for force-select test may still be used in some places.
        violations.push(f);
      }
    }
    expect(violations).toEqual([]);
  });
});
