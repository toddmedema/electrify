/* tslint:disable */

import * as Sequelize from 'sequelize';
import { User } from 'shared/schema/Users';
import { toSequelize } from './Schema';

export interface UserInstance extends Sequelize.Model<Partial<User>> {
  dataValues: User;
}
export type UserModel = {
  new (): UserInstance;
} & typeof Sequelize.Model;

export const AUTH_SESSION_TABLE = 'AuthSession';

export class Database {
  public sequelize: Sequelize.Sequelize;

  public users: UserModel;

  constructor(s: Sequelize.Sequelize) {
    this.sequelize = s;
    this.setupModels();
  }

  private setupModels() {
    const standardOptions = {
      timestamps: true,
      // https://github.com/ExpeditionRPG/api/issues/39
      underscored: true,
    };

    const userSpec = toSequelize(new User({ id: '' }));
    this.users = this.sequelize.define('users', userSpec, {
      ...standardOptions,
      timestamps: false, // TODO: eventually switch to sequelize timestamps
      underscored: undefined,
    }) as UserModel;

    // This doesn't need an independent spec - it is used by connect-session-sequelize
    // https://www.npmjs.com/package/connect-session-sequelize
    // We redeclare it here so we can apply a custom name.
    const authSession = this.sequelize.define(AUTH_SESSION_TABLE, {
      data: Sequelize.TEXT,
      expires: Sequelize.DATE,
      sid: {
        primaryKey: true,
        type: Sequelize.STRING(32),
      },
    });
    authSession.sync();
  }
}
