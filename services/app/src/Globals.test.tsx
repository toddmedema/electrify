import {getDevicePlatform, setDeviceForTest} from './Globals';

describe('Globals', () => {

  describe('getDevicePlatform', () => {
    // Disabled for now because of unexpected behavior with Phantom
    test('reports web if no device inititialized', () => {
      // No initialization at all
      expect(getDevicePlatform()).toEqual('web');
    });

    test('defaults to web on unexpected device', () => {
      setDeviceForTest({platform: 'zune'});
      expect(getDevicePlatform()).toEqual('web');
    });
  });
});
