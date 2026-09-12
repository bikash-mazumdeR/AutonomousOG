Feature: Swag Labs Authentication Gateway
  As a User,
  I want to Authenticate using standard credentials
  So that Access the inventory catalog.

  Background:
    Given the user is on the login page

  @positive @functional @ui @smoke @regression @tc-024 @obsolete
  Scenario: [TC-024] [ui] The login page must display page title Swag Labs
    Given Navigate to the feature: Login UI, Accessibility, and Input Controls
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@ui] The login page must display page title 'Swag Labs', a centered form layout
    And with test data "{{validTestData}}"
    Then [@ui] The login page must display page title 'Swag Labs', a centered form layout, functional branding logo, and test credentials display box across responsive viewports from 320px to 2560px width.
    Then System confirms: [@ui] The login page must display page title 'Swag Labs', a centered form layout, functional branding logo, and test credentials display box across responsive viewports from 320px to 2560px width.

  @positive @functional @ui @smoke @regression @tc-025 @obsolete
  Scenario: [TC-025] [ui] The Username field must accept alphanumeric charact
    Given Navigate to the feature: Login UI, Accessibility, and Input Controls
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@ui] The Username field must accept alphanumeric characters, hyphens, and under
    And with test data "{{validName}}"
    Then [@ui] The Username field must accept alphanumeric characters, hyphens, and underscores up to 255 characters, trim leading and trailing spaces, and enforce case-sensitivity.
    Then System confirms: [@ui] The Username field must accept alphanumeric characters, hyphens, and underscores up to 255 characters, trim leading and trailing spaces, and enforce case-sensitivity.

  @positive @functional @ui @smoke @regression @tc-026 @obsolete
  Scenario: [TC-026] [security] The Password field must mask all entered char
    Given Navigate to the feature: Login UI, Accessibility, and Input Controls
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@security] The Password field must mask all entered characters as dots or aster
    And with test data "{{validPassword}}"
    Then [@security] The Password field must mask all entered characters as dots or asterisks, accept up to 512 characters, and support browser default paste operations.
    Then System confirms: [@security] The Password field must mask all entered characters as dots or asterisks, accept up to 512 characters, and support browser default paste operations.

  @positive @functional @ui @smoke @regression @tc-027 @obsolete
  Scenario: [TC-027] [ui] The Login submit button must remain in an enabled s
    Given Navigate to the feature: Login UI, Accessibility, and Input Controls
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@ui] The Login submit button must remain in an enabled state at all times (incl
    And with test data "{{validTestData}}"
    Then [@ui] The Login submit button must remain in an enabled state at all times (including upon click and submission) and provide visual cursor/color feedback on hover.
    Then System confirms: [@ui] The Login submit button must remain in an enabled state at all times (including upon click and submission) and provide visual cursor/color feedback on hover.
    Then Changes are retained after page reload

  @positive @functional @ui @smoke @regression @tc-028 @obsolete
  Scenario: [TC-028] [accessibility] The interface must comply with WCAG 21
    Given Navigate to the feature: Login UI, Accessibility, and Input Controls
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@accessibility] The interface must comply with WCAG 2.1 Level AA, supporting fu
    And with test data "{{validTestData}}"
    Then [@accessibility] The interface must comply with WCAG 2.1 Level AA, supporting full keyboard navigation (Tab/Enter), color contrast ratio of at least 4.5:1, input ARIA labels, and screen reader announcements for displayed error messages.
    Then System confirms: [@accessibility] The interface must comply with WCAG 2.1 Level AA, supporting full keyboard navigation (Tab/Enter), color contrast ratio of at least 4.5:1, input ARIA labels, and screen reader announcements for displayed error messages.

  @negative @functional @ui @smoke @regression @tc-029 @obsolete
  Scenario: [TC-029] Submit with empty mandatory field
    Given Navigate to: Login UI, Accessibility, and Input Controls
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Leave required field blank and submit
    Then Inline validation error shown. Form not submitted.
    Then Inline validation error shown. Form not submitted.

  @negative @functional @ui @smoke @regression @tc-031 @obsolete
  Scenario: [TC-031] Access with insufficient permissions
    Given Navigate to: Login UI, Accessibility, and Input Controls
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Log in as a role that lacks required permission
    And with test data "{{lowPrivilegeUserCredentials}}"
    Then HTTP 403 returned. Access denied message shown.
    Then HTTP 403 returned. Access denied message shown.

  @negative @functional @ui @smoke @regression @tc-032 @obsolete
  Scenario: [TC-032] Enter SQL injection payload
    Given Navigate to: Login UI, Accessibility, and Input Controls
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Enter SQL injection string: ' OR '1'='1
    And with test data "' OR '1'='1'; DROP TABLE users;--"
    Then Input is sanitized. No SQL error exposed. Input treated as plain text.
    When Enter valid data for all other mandatory fields (e.g., password)
    And with test data "{{validMandatoryInputs}}"
    Then Mandatory fields populated to isolate target field validation
    When Submit form and verify error handling response
    Then Input is sanitized. No SQL error exposed. Input treated as plain text.

  @negative @functional @ui @smoke @regression @tc-033 @obsolete
  Scenario: [TC-033] Enter XSS payload in text field
    Given Navigate to: Login UI, Accessibility, and Input Controls
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Enter <script>alert("xss")</script> in input
    And with test data "<script>alert("xss")</script>"
    Then Script tag is escaped/rejected. No alert executes.
    When Enter valid data for all other mandatory fields (e.g., password)
    And with test data "{{validMandatoryInputs}}"
    Then Mandatory fields populated to isolate target field validation
    When Submit form and verify error handling response
    Then Script tag is escaped/rejected. No alert executes.

  @negative @functional @ui @smoke @regression @tc-034 @obsolete
  Scenario: [TC-034] Use expired session token
    Given Navigate to: Login UI, Accessibility, and Input Controls
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Wait for session to expire, then perform action
    And with test data "{{expiredJwtToken}}"
    Then Session expiry message shown. Redirect to login.
    Then Session expiry message shown. Redirect to login.
