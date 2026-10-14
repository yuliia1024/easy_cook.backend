import { AppLogger } from './app-logger';
import { runWithRequestId } from './request-context';

describe('AppLogger', () => {
  let write: jest.SpyInstance;

  const output = (): string => write.mock.calls.map(([chunk]) => String(chunk)).join('');

  beforeEach(() => {
    write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  describe('text', () => {
    const logger = new AppLogger({ colors: false });

    it('tags lines logged inside a request with its id', () => {
      runWithRequestId('req-1', () => logger.log('hello', 'Menu'));

      expect(output()).toContain('[Menu] [req req-1] hello');
    });

    it('leaves lines outside a request untouched', () => {
      logger.log('hello', 'Menu');

      expect(output()).toContain('[Menu] hello');
      expect(output()).not.toContain('[req');
    });
  });

  describe('json', () => {
    const logger = new AppLogger({ json: true });

    it('adds the request id as a field', () => {
      runWithRequestId('req-1', () => logger.log('hello', 'Menu'));

      expect(JSON.parse(output())).toMatchObject({
        message: 'hello',
        context: 'Menu',
        requestId: 'req-1',
      });
    });

    it('omits it outside a request', () => {
      logger.log('hello', 'Menu');

      expect(JSON.parse(output())).not.toHaveProperty('requestId');
    });
  });
});
