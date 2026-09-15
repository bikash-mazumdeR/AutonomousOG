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

  it('should create a logger with a component name', () => {
    const l = new Logger('MyAgent', { writeToFile: false });
    l.info('test');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('[MyAgent]');
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

  it('should include metadata in output', () => {
    logger.info('test', { key: 'value', count: 3 });
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('"key":"value"');
    expect(output).toContain('"count":3');
  });

  it('should format stage lifecycle events with metadata', () => {
    logger.stage('COMPLETE', '02-test-gen', { totalTCs: 45 });
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('[STAGE:COMPLETE]');
    expect(output).toContain('02-test-gen');
    expect(output).toContain('"totalTCs":45');
  });

  it('should format clarification requests', () => {
    logger.clarification('01-analyzer', 'What is the target URL?');
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('[CLARIFICATION]');
    expect(output).toContain('01-analyzer');
  });
});
