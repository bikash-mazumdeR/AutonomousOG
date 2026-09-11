/**
 * @fileoverview Unit tests for the Logger module.
 * Tests log level filtering, structured output, and stage/clarification helpers.
 */

import { Logger } from '../../core/logger/Logger';

describe('Logger', () => {
  let logger: Logger;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    // Suppress console output during tests
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    // Disable file writing during tests
    logger = new Logger('TestComponent', { writeToFile: false });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // ── Construction ──────────────────────────────────────────────────────────

  describe('construction', () => {
    it('should create a logger with a component name', () => {
      const l = new Logger('MyAgent', { writeToFile: false });
      l.info('test');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('[MyAgent]');
    });

    it('should respect custom log level', () => {
      const warnLogger = new Logger('WarnOnly', { level: 'warn', writeToFile: false });
      warnLogger.debug('should not appear');
      warnLogger.info('should not appear');
      expect(consoleSpy).not.toHaveBeenCalled();

      warnLogger.warn('should appear');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Level Methods ─────────────────────────────────────────────────────────

  describe('log levels', () => {
    it('should log debug messages when level is debug', () => {
      const debugLogger = new Logger('Debug', { level: 'debug', writeToFile: false });
      debugLogger.debug('debug message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0][0]).toContain('DEBUG');
    });

    it('should log info messages', () => {
      logger.info('info message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0][0]).toContain('INFO');
    });

    it('should log warn messages', () => {
      logger.warn('warning message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0][0]).toContain('WARN');
    });

    it('should log error messages', () => {
      logger.error('error message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0][0]).toContain('ERROR');
    });

    it('should log fatal messages', () => {
      logger.fatal('fatal message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0][0]).toContain('FATAL');
    });

    it('should filter messages below minimum level', () => {
      const errorLogger = new Logger('ErrOnly', { level: 'error', writeToFile: false });
      errorLogger.debug('no');
      errorLogger.info('no');
      errorLogger.warn('no');
      expect(consoleSpy).not.toHaveBeenCalled();

      errorLogger.error('yes');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  describe('metadata', () => {
    it('should include metadata in output', () => {
      logger.info('test', { key: 'value', count: 3 });
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('"key":"value"');
      expect(output).toContain('"count":3');
    });

    it('should not include metadata marker when no meta provided', () => {
      logger.info('clean message');
      const output = consoleSpy.mock.calls[0][0] as string;
      // Should just have the message, no JSON metadata
      expect(output).toContain('clean message');
    });
  });

  // ── Stage Helper ──────────────────────────────────────────────────────────

  describe('stage()', () => {
    it('should format stage lifecycle events', () => {
      logger.stage('START', '01-requirement-analyzer');
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('[STAGE:START]');
      expect(output).toContain('01-requirement-analyzer');
    });

    it('should include additional metadata', () => {
      logger.stage('COMPLETE', '02-test-gen', { totalTCs: 45 });
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('[STAGE:COMPLETE]');
      expect(output).toContain('"totalTCs":45');
    });
  });

  // ── Clarification Helper ──────────────────────────────────────────────────

  describe('clarification()', () => {
    it('should format clarification requests', () => {
      logger.clarification('01-analyzer', 'What is the target URL?');
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain('[CLARIFICATION]');
      expect(output).toContain('01-analyzer');
    });
  });
});

