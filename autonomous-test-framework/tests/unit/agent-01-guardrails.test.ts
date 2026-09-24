/**
 * @fileoverview Unit tests for Agent 01's output guardrails: secret redaction and grounding of concrete claims.
 */

import {
  concreteClaims, findUngroundedClaims, profileSecrets, redactSecrets, redactText,
} from '../../agents/01-requirement-analyzer/guardrails';

const PASSWORD = 'Sample#Pass9';
const EMAIL = 'qa.user@example.test';

const requirement = [
  '## Login',
  `Test account: ${EMAIL} / ${PASSWORD}`,
  'AC-1: Entering valid credentials and clicking Sign In redirects to https://app.example.test/ with the header "Dashboard".',
  'AC-2: An empty email shows the message “Email is required”.',
  'AC-3: The password must be at least 12 characters; one character fewer is rejected.',
].join('\n');

const analysis = () => ({
  features: [{
    id: 'F-01',
    name: 'Login',
    userStories: [{
      id: 'US-01',
      acceptanceCriteria: [
        `[@functional] Entering valid credentials (${EMAIL} / ${PASSWORD}) and clicking Sign In redirects to https://app.example.test/ with the header 'Dashboard'.`,
        '[@error-handling] An empty email shows the message "Email is required".',
        '[@functional] A password of 11 characters is rejected; 1 character fewer than the minimum fails.',
      ],
      testDataValues: [
        { name: 'validEmail', value: EMAIL, sourceRef: 'AC-1', sensitive: false },
        { name: 'validPassword', value: PASSWORD, sourceRef: 'AC-1', sensitive: true },
        { name: 'invalidPassword', value: 'wrong-pass', sourceRef: 'AC-3', sensitive: false },
      ],
    }],
  }],
  integrationPoints: [{ id: 'IP-01', name: 'Database', endpoint: 'N/A' }],
  ambiguities: [{ id: 'AMB-01', question: `Should ${PASSWORD} expire?` }],
});

describe('Agent 01 guardrails — secrets', () => {
  const profile = { auth: { credentialEnvVars: { validEmail: 'APP_EMAIL', validPassword: 'APP_PASSWORD' } }, secretsEnvVars: ['APP_EMAIL', 'APP_PASSWORD', 'APP_TOKEN'] };

  it('names each profile secret after its credential binding, else after its variable, and skips unset ones', () => {
    expect(profileSecrets(profile, { APP_EMAIL: EMAIL, APP_PASSWORD: PASSWORD })).toEqual([
      { value: EMAIL, placeholder: '{{validEmail}}' },
      { value: PASSWORD, placeholder: '{{validPassword}}' },
    ]);
    expect(profileSecrets(undefined, {})).toEqual([]);
  });

  it('drops a sensitive value the model kept, and replaces it everywhere else in the analysis', () => {
    // The model marked the password sensitive but still wrote it out, and quoted it in a criterion.
    const report: any = analysis();
    const { warnings } = redactSecrets(report, []);
    const story = report.features[0].userStories[0];
    expect(story.testDataValues[1]).toEqual({ name: 'validPassword', sourceRef: 'AC-1', sensitive: true });
    expect(story.acceptanceCriteria[0]).toContain('/ {{validPassword}})');
    expect(report.ambiguities[0].question).toBe('Should {{validPassword}} expire?');
    expect(JSON.stringify(report)).not.toContain(PASSWORD);
    expect(warnings.join(' ')).not.toContain(PASSWORD);
  });

  it('treats a value named like a secret as one even when the model called it not sensitive', () => {
    const report: any = analysis();
    report.features[0].userStories[0].testDataValues[1].sensitive = false;
    redactSecrets(report, []);
    expect(JSON.stringify(report)).not.toContain(PASSWORD);
  });

  it('keeps a deliberately wrong value a negative case needs, and redacts the secrets the profile names', () => {
    const report: any = analysis();
    redactSecrets(report, profileSecrets(profile, { APP_EMAIL: EMAIL, APP_PASSWORD: PASSWORD }));
    const story = report.features[0].userStories[0];
    expect(story.testDataValues[2].value).toBe('wrong-pass');
    expect(story.acceptanceCriteria[0]).toContain('({{validEmail}} / {{validPassword}})');
    expect(JSON.stringify(report)).not.toContain(EMAIL);
  });
});

describe('Agent 01 guardrails — grounding', () => {
  it('extracts quoted wording, URLs and multi-digit numbers, never a single digit or a placeholder', () => {
    expect(concreteClaims(`Shows 'Log out' and “Sign in”, visits https://a.test/x. Waits 30 s, 2.5 s or 1 s; enters {{validEmail}}; the user's name`))
      .toEqual(['Sign in', 'Log out', 'https://a.test/x', '30', '2.5']);
  });

  it('accepts claims the document makes in other quote marks or spacing, and reports invented ones', () => {
    const report: any = analysis();
    const { secrets } = redactSecrets(report, []);
    const warnings = findUngroundedClaims(report, redactText(requirement, secrets));
    // "11" is not in the document (it says 12 and "one character fewer"); everything else is.
    expect(warnings).toEqual(['Ungrounded: US-01 AC-3 states "11", which the requirement does not contain.']);
  });

  it('treats an address with a trailing slash as the one the document names, but not an added path', () => {
    const report: any = { features: [{ userStories: [{ id: 'US-01', acceptanceCriteria: ['Opens https://app.example.test/ first', 'Then https://app.example.test/login'] }] }] };
    expect(findUngroundedClaims(report, 'Go to [https://app.example.test](https://app.example.test).'))
      .toEqual(['Ungrounded: US-01 AC-2 states "https://app.example.test/login", which the requirement does not contain.']);
  });

  it('reports an invented message, URL and endpoint, and ignores an endpoint marked N/A', () => {
    const report: any = analysis();
    report.features[0].userStories[0].acceptanceCriteria.push("[@error-handling] A locked account shows 'Too many attempts' and links to https://help.example.test.");
    report.integrationPoints.push({ id: 'IP-02', name: 'Auth API', endpoint: '/api/v2/login' });
    const warnings = findUngroundedClaims(report, requirement);
    expect(warnings).toEqual(expect.arrayContaining([
      'Ungrounded: US-01 AC-4 states "Too many attempts", which the requirement does not contain.',
      'Ungrounded: US-01 AC-4 states "https://help.example.test", which the requirement does not contain.',
      'Ungrounded: IP-02 endpoint "/api/v2/login" is not named in the requirement.',
    ]));
    expect(warnings.some((w) => w.includes('IP-01'))).toBe(false);
  });
});
