/**
 * @fileoverview State identity: a state is its URL path plus the dialog or menu open on it, so a single-page
 * application that opens overlays without changing its address yields one state per view.
 */

import {
  PageMap, emptyPageMap, mergeState, overlayLabel, stateKey, stateNameFor,
} from '../../agents/05-playwright-script-generator/discovery/pageMap';
import { detectOverlay } from '../../agents/05-playwright-script-generator/discovery/domDiscovery';
import { verifiedStatesFor } from '../../agents/05-playwright-script-generator/discovery/flowExtractor';
import { verifiedUrlFor, ValidationContext } from '../../agents/05-playwright-script-generator/validation/integrityValidator';
import { AutomationTestCase } from '../../agents/05-playwright-script-generator/contracts/automationTestCase';

const button = (name: string) => ({
  name: `${name}Button`, strategy: 'role' as const, args: ['button', name], tag: 'button', role: 'button', accessibleName: name,
});

describe('Agent 05 state identity — URL path plus open overlay', () => {
  it('names a dialog state by its title and a menu state by its role', () => {
    expect(stateNameFor('/', undefined, new Set())).toBe('start');
    expect(stateNameFor('/', { role: 'alertdialog', name: 'Log out?' }, new Set())).toBe('startLogOutDialog');
    expect(stateNameFor('/', { role: 'dialog', name: 'Delete this post permanently from the site' }, new Set())).toBe('startDeleteThisPostPermanentlyDialog');
    expect(stateNameFor('/', { role: 'dialog' }, new Set())).toBe('startDialog');
    // A menu is usually named after its trigger — the signed-in user's initial here — which must not name a state.
    expect(stateNameFor('/', { role: 'menu', name: 'B' }, new Set())).toBe('startMenu');
    expect(stateNameFor('/account/settings.html', { role: 'menu' }, new Set(['accountSettingsMenu']))).toBe('accountSettingsMenu2');
  });

  it('keys states by URL and overlay, and labels overlays for the planner and the contract', () => {
    expect(stateKey({ urlPath: '/' })).toBe('/|');
    expect(stateKey({ urlPath: '/', overlay: { role: 'menu' } })).toBe('/|menu');
    expect(stateKey({ urlPath: '/', overlay: { role: 'alertdialog', name: 'Log out?' } })).toBe('/|alertdialog "Log out?"');
    expect(overlayLabel(undefined)).toBeUndefined();
    expect(overlayLabel({ role: 'alertdialog', name: 'Log out?' })).toBe('alertdialog "Log out?"');
  });

  it('merges a capture into the state with the same URL and overlay only', () => {
    const map = emptyPageMap('F-01');
    mergeState(map, { name: 'start', urlPath: '/', entryPath: '/', elements: [button('B')] });
    mergeState(map, { name: 'startMenu', urlPath: '/', overlay: { role: 'menu' }, elements: [button('Logout')] });
    const again = mergeState(map, { name: 'startMenu', urlPath: '/', overlay: { role: 'menu' }, elements: [button('Logout'), button('Profile')] });
    mergeState(map, { name: 'startLogOutDialog', urlPath: '/', overlay: { role: 'alertdialog', name: 'Log out?' }, elements: [button('Cancel')] });

    expect(map.states.map((s) => s.name)).toEqual(['start', 'startMenu', 'startLogOutDialog']);
    expect(again.elements.map((e) => e.name)).toEqual(['LogoutButton', 'ProfileButton']);
    expect(map.states[0].elements.map((e) => e.name)).toEqual(['BButton']);
  });

  it('picks the overlay of highest precedence, the topmost of its role, and ignores hidden ones', () => {
    expect(detectOverlay([{ tag: 'div', role: 'menu', name: 'B' }])).toEqual({ role: 'menu', name: 'B' });
    expect(detectOverlay([{ tag: 'div', role: 'menu' }, { tag: 'div', role: 'alertdialog', name: 'Log out?' }])).toEqual({ role: 'alertdialog', name: 'Log out?' });
    expect(detectOverlay([{ tag: 'div', role: 'dialog', name: 'First' }, { tag: 'div', role: 'dialog', name: 'Second' }])).toEqual({ role: 'dialog', name: 'Second' });
    expect(detectOverlay([{ tag: 'div', role: 'dialog', name: 'Closed', ariaHidden: true }, { tag: 'button', role: 'button', name: 'B' }])).toBeUndefined();
  });

  it('never lets an overlay state prove a step with its URL', () => {
    const map: PageMap = {
      ...emptyPageMap('F-01'),
      states: [
        { name: 'start', urlPath: '/', entryPath: '/', elements: [] },
        { name: 'startLogOutDialog', urlPath: '/', overlay: { role: 'alertdialog', name: 'Log out?' }, elements: [] },
      ],
    };
    const verifiedStates = verifiedStatesFor({ tcKey: 'TC-003', runs: [], stateAfterStep: { 1: 'start', 2: 'startLogOutDialog' } }, map);
    expect(verifiedStates).toEqual({ 1: { state: 'start', urlPath: '/' }, 2: { state: 'startLogOutDialog', urlPath: '/', overlay: 'alertdialog "Log out?"' } });

    const tc = {
      steps: [
        { index: 1, expected: ['the start page is displayed'] },
        { index: 2, expected: ['the log out dialog is displayed and the user remains on the page'] },
      ],
    } as unknown as AutomationTestCase;
    const ctx: ValidationContext = { mode: 'UI', tc, harness: '', verifiedStates };
    expect(verifiedUrlFor(ctx, 1)).toBe('/');
    expect(verifiedUrlFor(ctx, 2)).toBeUndefined();
  });
});
