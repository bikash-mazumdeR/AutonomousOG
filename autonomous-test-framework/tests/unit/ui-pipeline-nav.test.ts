/**
 * @fileoverview Every agent page uses the shared pipeline bar, so completed stages stay reachable, and every UI server
 * exposes the stage overview it reads.
 */

import * as fs from 'fs';
import * as path from 'path';

const UI_ROOT = path.resolve(__dirname, '../../ui');
const PAGES: Array<[string, number]> = [['agent01.html', 1], ['agent02.html', 2], ['agent03.html', 3], ['agent04.html', 4], ['agent05.html', 5]];
const SERVERS = ['agent01-ui-server.ts', 'agent02-ui-server.ts', 'agent03-ui-server.ts', 'agent04-ui-server.ts', 'agent05-ui-server.ts'];

describe('Pipeline navigation', () => {
  it.each(PAGES)('%s renders the shared bar for its own stage', (page, stage) => {
    const html = fs.readFileSync(path.join(UI_ROOT, 'static', page), 'utf-8');
    expect(html).toContain('<script src="/pipeline-nav.js"></script>');
    expect(html).toContain(`AriaPipelineNav.start(${stage})`);
    expect(html).not.toMatch(/step-node done'|PIPELINE_STAGES|const STAGES/);
  });

  it('links every stage that has a page', () => {
    const nav = fs.readFileSync(path.join(UI_ROOT, 'static', 'pipeline-nav.js'), 'utf-8');
    PAGES.forEach(([page]) => expect(nav).toContain(`page: '/${page}'`));
  });

  it.each(SERVERS)('%s serves the stage overview', (server) => {
    expect(fs.readFileSync(path.join(UI_ROOT, server), 'utf-8')).toContain('registerPipelineRoutes(app);');
  });
});
