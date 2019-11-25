import * as express from 'express';
import * as Handlers from './Handlers';
import { limitCors } from './lib/cors';
import { installOAuthRoutes, oauth2Template } from './lib/oauth2';
import { Database } from './models/Database';

export function installRoutes(db: Database, router: express.Router) {
  // Use the oauth middleware to automatically get the user's profile
  // information and expose login/logout URLs to templates.
  router.use(oauth2Template);

  // We store auth details in res.locals. If there's no stored data there, the user is not logged in.
  // function requireAuth(
  //   req: express.Request,
  //   res: express.Response,
  //   next: express.NextFunction,
  // ) {
  //   if (!res.locals || !res.locals.id) {
  //     return res.status(500).end('You are not signed in.');
  //   }
  //   next();
  // }

  router.options('/*', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.get('origin'));
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Content-Length, X-Requested-With',
    );
    res.sendStatus(200);
  });

  router.get('/healthcheck', limitCors, Handlers.healthCheck);
  router.get('/announcements', limitCors, Handlers.announcement);

  installOAuthRoutes(db, router);
}
