export enum Difficulty {
  easy = 'EASY',
  normal = 'NORMAL',
  hard = 'HARD',
  impossible = 'IMPOSSIBLE',
}

export const VERSION = (process && process.env && process.env.VERSION) || '0.0.1'; // Webpack
export const NODE_ENV = (process && process.env && process.env.NODE_ENV) || 'dev';

export const AUTH_SETTINGS = {
  // Android: '545484140970-qrhcn069bbvae1mub2237h5k32mnp04k.apps.googleusercontent.com',
  // iOS: (REVERSE_CLIENT_ID) '545484140970-lgcbm3df469kscbngg2iof57muj3p588.apps.googleusercontent.com',
  API_KEY: 'AIzaSyCgvf8qiaVoPE-F6ZGqX6LzukBftZ6fJr8',
  CLIENT_ID: (process && process.env && process.env.OAUTH2_CLIENT_ID) || '545484140970-jq9jp7gdqdugil9qoapuualmkupigpdl.apps.googleusercontent.com',
  SCOPES: 'profile email',
  URL_BASE: API_HOST,
};
