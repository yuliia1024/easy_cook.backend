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

  describe('colors', () => {
    const logger = new AppLogger({ colors: true, logLevels: ['log', 'debug'] });
    const MAGENTA = '\x1B[95m';
    const GREEN = '\x1B[32m';

    it('prints debug text uncoloured and keeps the DEBUG label coloured', () => {
      logger.debug('SELECT 1', 'PrismaService');

      expect(output()).toContain(`${MAGENTA}  DEBUG`);
      expect(output()).not.toContain(`${MAGENTA}SELECT 1`);
      expect(output()).toContain('SELECT 1');
    });

    it('still colours other levels', () => {
      logger.log('hello', 'Menu');

      expect(output()).toContain(`${GREEN}hello`);
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
