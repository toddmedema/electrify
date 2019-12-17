export enum Difficulty {
  easy = 'EASY',
  normal = 'NORMAL',
  hard = 'HARD',
  impossible = 'IMPOSSIBLE',
}

export const VERSION = (process && process.env && process.env.VERSION) || '0.0.1'; // Webpack
export const NODE_ENV = (process && process.env && process.env.NODE_ENV) || 'dev';
