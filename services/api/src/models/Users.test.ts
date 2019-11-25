import { Database } from './Database';
import {
  testingDBWithState,
  users as u,
} from './TestData';
import {
  getUser,
  incrementLoginCount,
  maybeGetUserByEmail,
  setLootPoints,
} from './Users';

describe('users', () => {
  describe('incrementLoginCount', () => {
    test('increments for existing user', done => {
      let db: Database;
      testingDBWithState([u.basic])
        .then(tdb => {
          db = tdb;
          return incrementLoginCount(db, u.basic.id);
        })
        .then(() => {
          return getUser(db, u.basic.id);
        })
        .then(r => {
          expect(r.loginCount).toEqual(u.basic.loginCount + 1);
          expect(r.lastLogin.getTime()).toBeGreaterThan(
            u.basic.lastLogin.getTime(),
          );
          done();
        })
        .catch(done.fail);
    });
  });

  describe('setLootPoints', () => {
    test('sets the loot points', done => {
      let db: Database;
      testingDBWithState([u.basic])
        .then(tdb => {
          db = tdb;
          return setLootPoints(db, u.basic.id, 37);
        })
        .then(() => {
          return getUser(db, u.basic.id);
        })
        .then(user => {
          expect(user.lootPoints).toEqual(37);
          done();
        })
        .catch(done.fail);
    });
  });

  describe('maybeGetUserByEmail', () => {
    test('returns user if exists', done => {
      testingDBWithState([u.basic])
        .then(tdb => {
          return maybeGetUserByEmail(tdb, u.basic.email);
        })
        .then(user => {
          expect((user || { id: null }).id).toEqual(u.basic.id);
          done();
        })
        .catch(done.fail);
    });

    test('returns null if not exists', done => {
      testingDBWithState([])
        .then(tdb => {
          return maybeGetUserByEmail(tdb, u.basic.email);
        })
        .then(user => {
          expect(user).toEqual(null);
          done();
        })
        .catch(done.fail);
    });
  });
});
