import { Sequelize } from 'sequelize';
import { SchemaBase } from 'shared/schema/SchemaBase';
import { User } from 'shared/schema/Users';
import { Database } from './Database';
import { prepare } from './Schema';

export const TEST_NOW = new Date('2017-12-18T19:32:38.397Z');

export const users = {
  basic: new User({
    created: TEST_NOW,
    email: 'test@test.com',
    id: 'test',
    lastLogin: TEST_NOW,
    lootPoints: 0,
    name: 'Test Testerson',
  }),
};

export function testingDBWithState(state: SchemaBase[]): Promise<Database> {
  const db = new Database(
    new Sequelize({
      dialect: 'sqlite',
      logging: false,
      storage: ':memory:',
    }),
  );

  return Promise.all([
    db.users.sync(),
  ])
    .then(() =>
      Promise.all(
        state.map(entry => {
          if (entry instanceof User) {
            return db.users.create(prepare(entry)).then(() => null);
          }
          throw new Error('Unsupported entry for testingDBWithState');
        }),
      ),
    )
    .then(() => db);
}
