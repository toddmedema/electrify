import * as Bluebird from 'bluebird';
import * as cheerio from 'cheerio';
import * as express from 'express';
import * as memoize from 'memoizee';
import * as request from 'request-promise';
import Config from './config';

const REGEX_SEMVER = /[1-9][0-9]?[0-9]?\.[1-9][0-9]?[0-9]?\.[1-9][0-9]?[0-9]?/g;

export function healthCheck(req: express.Request, res: express.Response) {
  res.status(200).end(' ');
}

interface Versions {
  android: string;
  ios: string;
  web: string;
}

function getAndroidVersion(): Bluebird<string | null> {
  return request(
    'https://play.google.com/store/apps/details?id=io.fabricate.expedition',
  )
    .then((body: string) => {
      const $ = cheerio.load(body);
      const versionText = $('div:contains("Version")').text() || '';
      const result = REGEX_SEMVER.exec(versionText) || [];
      return result[0] || '1.0.0';
    })
    .catch((e: Error) => {
      return null;
    });
}

function getIosVersion(): Bluebird<string | null> {
  return request(
    'http://itunes.apple.com/lookup?bundleId=io.fabricate.expedition',
  )
    .then((body: string) => {
      const version = JSON.parse(body).results[0].version;
      return version;
    })
    .catch((e: Error) => {
      return null;
    });
}

function getWebVersion(): Bluebird<string | null> {
  return request('http://app.expeditiongame.com/package.json')
    .then((body: string) => {
      const version = JSON.parse(body).version;
      return version;
    })
    .catch((e: Error) => {
      return null;
    });
}

function getVersions(date: string): Bluebird<Versions> {
  return Bluebird.all([
    getAndroidVersion(),
    getIosVersion(),
    getWebVersion(),
  ]).then(values => {
    return {
      android: values[0] || values[1] || '1.0.0', // Android scraping is fragile; fall back to iOS
      ios: values[1] || '1.0.0',
      web: values[2] || '1.0.0',
    };
  });
}

// TODO: Figure out why jest doesn't like importing memoizee
const memoizedVersions =
  typeof memoize === 'function'
    ? memoize(getVersions, { promise: true })
    : getVersions;

export function announcement(req: express.Request, res: express.Response) {
  memoizedVersions(new Date().toJSON().slice(0, 10)) // per day / 24 hour cache
    .then((versions: Versions) => {
      res.json({
        link: Config.get('ANNOUNCEMENT_LINK') || '',
        message: Config.get('ANNOUNCEMENT_MESSAGE') || '',
        versions,
      });
    });
}
