import { mockReq, mockRes } from 'sinon-express-mock';
import {
  healthCheck,
} from './Handlers';
import {
  Database,
} from './models/Database';
import {
  testingDBWithState,
  users as u,
} from './models/TestData';

interface DoneFn {
  (): void;
  fail: (error: Error) => void;
}

describe('handlers', () => {
  describe('healthCheck', () => {
    test('returns success', () => {
      const res = mockRes();
      healthCheck(mockReq({ body: '' }), res);
      expect(res.end.calledWith(' ')).toEqual(true);
      expect(res.status.getCall(0).args[0]).toEqual(200);
    });
  });

  describe('announcement', () => {
    test.skip('returns with message and link', () => {
      /* TODO */
    });
    test.skip('returns default version if unable to reach a version API', () => {
      /* TODO */
    });
    test.skip('returns the latest version from API', () => {
      /* TODO */
    });
    test.skip('caches valid version results', () => {
      /* TODO */
    });
  });
});
