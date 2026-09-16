/**
 * @fileoverview Every agent page uses the shared pipeline bar, so completed stages stay reachable, and every UI server
 * exposes the stage overview it reads.
 */

import * as fs from 'fs';
import * as path from 'path';

const UI_ROOT = path.resolve(__dirname, '../../ui');
const PAGES: Array<[string, number]> = [['agent01.html', 1], ['agent02.html', 2], ['agent03.html', 3], ['agent04.html', 4], ['agent05.html', 5], ['agent06.html', 6], ['agent07.html', 7], ['agent08.html', 8], ['agent09.html', 9], ['agent10.html', 10], ['agent11.html', 11]];
const SERVERS = ['agent01-ui-server.ts', 'agent02-ui-server.ts', 'agent03-ui-server.ts', 'agent04-ui-server.ts', 'agent05-ui-server.ts', 'agent06-ui-server.ts', 'agent07-ui-server.ts', 'agent08-ui-server.ts', 'agent09-ui-server.ts', 'agent10-ui-server.ts', 'agent11-ui-server.ts'];

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

  it('only navigates onward to stages that actually have a page', () => {
    // Stage 08 has no UI yet, so a hard-coded post-approval redirect would 404. The nav owns the
    // list of pages that exist; pages must ask it rather than assume the next stage is reachable.
    const nav = fs.readFileSync(path.join(UI_ROOT, 'static', 'pipeline-nav.js'), 'utf-8');
    expect(nav).toContain('pageForStage(stageNumber)');

    const page07 = fs.readFileSync(path.join(UI_ROOT, 'static', 'agent07.html'), 'utf-8');
    expect(page07).toContain('pageForStage(8)');
    expect(page07).not.toContain("href = '/agent08.html'");
  });

  it.each(SERVERS)('%s serves the stage overview', (server) => {
    expect(fs.readFileSync(path.join(UI_ROOT, server), 'utf-8')).toContain('registerPipelineRoutes(app);');
  });
});
