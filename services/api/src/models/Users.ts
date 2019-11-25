import * as Bluebird from 'bluebird';
import { Sequelize } from 'sequelize';
import { User } from 'shared/schema/Users';
import { Database } from './Database';

export function setLootPoints(db: Database, id: string, lootPoints: number) {
  return db.users.findOne({ where: { id } }).then(result => {
    if (result === null) {
      throw new Error('No user with ID ' + id);
    }
    result.update({ lootPoints });
  });
}

export function incrementLoginCount(db: Database, id: string) {
  return db.users.update(
    {
      loginCount: Sequelize.literal('login_count + 1') as any,
      lastLogin: Sequelize.literal('CURRENT_TIMESTAMP') as any,
    },
    { where: { id } },
  );
}

export function getUser(db: Database, id: string): Bluebird<User> {
  return db.users
    .findOne({ where: { id } })
    .then(result => new User(result ? result.get() : {}));
}

export function maybeGetUserByEmail(
  db: Database,
  email: string,
): Bluebird<User | null> {
  return db.users
    .findOne({ where: { email } })
    .then(result => (result ? new User(result.get()) : null));
}
