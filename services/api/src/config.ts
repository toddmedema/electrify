const nconf = require('nconf');
const Path = require('path');

const CONFIG_PATH = Path.join(__dirname, '../config.json');

console.log('Loading config from ' + CONFIG_PATH);

nconf.argv()
.env([
  // Quest storage config settings
  'DATABASE_URL', // URL of postgres database storing quest metadata, user data, feedback, etc.
  'SEQUELIZE_LOGGING', // Enable console logging of sequelize SQL queries
  'SEQUELIZE_SSL',

  // Authentication config settings
  'OAUTH2_CLIENT_ID',
  'OAUTH2_CLIENT_SECRET',

  // Web server config settings
  'PORT',
  'SESSION_SECRET',

  // Specify prod or dev environment.
  'NODE_ENV',

  // The URL that points to this server.
  'API_URL_BASE',

  // Users allowed to access the admin pages
  'SUPER_USER_IDS',

  // Announcements
  'ANNOUNCEMENT_MESSAGE',
  'ANNOUNCEMENT_LINK',
])
.file({ file: CONFIG_PATH })
.defaults({
  ENABLE_PAYMENT: false,
  OAUTH2_CALLBACK: 'http://localhost:8080/auth/google/callback',
  OAUTH2_CLIENT_ID: '',
  OAUTH2_CLIENT_SECRET: '',
  PORT: 8081,
  SEQUELIZE_LOGGING: true,
  SUPER_USER_IDS: [],
  SEQUELIZE_SSL: true,
});

export default nconf;
