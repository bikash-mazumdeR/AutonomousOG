Feature: Swag Labs Authentication Gateway
  As a user of the application,
  I want to Allow users to authenticate securely using their credentials and receive appropriate validation feedback.
  So that access protected functionality.

  Background:
    Given the user is on the login page

  @positive @functional @ui @regression @tc-001
  Scenario: [TC-001] [functional] Given valid credentials for standard_user
    Given Navigate to the feature: User Authentication and Session Management
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@functional] Given valid credentials for 'standard_user' with password 'secret_
    And with test data "{{validPassword}}"
    Then System confirms: [@functional] Given valid credentials for 'standard_user' with password 'secret_sauce', when the user clicks Login, the system authenticates the user, generates and persists the session token in browser Local Storage, and redirects to '/inventory.html'.
    Then System confirms: [@functional] Given valid credentials for 'standard_user' with password 'secret_sauce', when the user clicks Login, the system authenticates the user, generates and persists the session token in browser Local Storage, and redirects to '/inventory.html'.

  @positive @functional @ui @regression @tc-002
  Scenario: [TC-002] [performance] Given valid credentials for performance_g
    Given Navigate to the feature: User Authentication and Session Management
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@performance] Given valid credentials for 'performance_glitch_user' with passwo
    And with test data "{{validPassword}}"
    Then System confirms: [@performance] Given valid credentials for 'performance_glitch_user' with password 'secret_sauce', when the user clicks Login, authentication succeeds and redirects to '/inventory.html' with simulated latency.
    Then System confirms: [@performance] Given valid credentials for 'performance_glitch_user' with password 'secret_sauce', when the user clicks Login, authentication succeeds and redirects to '/inventory.html' with simulated latency.

  @positive @functional @ui @regression @tc-003
  Scenario: [TC-003] [functional] Given credentials for specialized test acco
    Given Navigate to the feature: User Authentication and Session Management
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@functional] Given credentials for specialized test accounts ('problem_user', '
    And with test data "{{validPassword}}"
    Then System confirms: [@functional] Given credentials for specialized test accounts ('problem_user', 'error_user', 'visual_user') with password 'secret_sauce', authentication succeeds and redirects to '/inventory.html' reflecting their designated QA behaviors.
    Then System confirms: [@functional] Given credentials for specialized test accounts ('problem_user', 'error_user', 'visual_user') with password 'secret_sauce', authentication succeeds and redirects to '/inventory.html' reflecting their designated QA behaviors.

  @positive @functional @ui @regression @tc-004
  Scenario: [TC-004] [security] All authentication traffic must be encrypted
    Given Navigate to the feature: User Authentication and Session Management
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@security] All authentication traffic must be encrypted over HTTPS (TLS 1.2+),
    And with test data "{{validTestData}}"
    Then [@security] All authentication traffic must be encrypted over HTTPS (TLS 1.2+), enforce parameterized queries against SQL injection, sanitize inputs against XSS, and maintain an idle session timeout of 30 minutes.
    Then System confirms: [@security] All authentication traffic must be encrypted over HTTPS (TLS 1.2+), enforce parameterized queries against SQL injection, sanitize inputs against XSS, and maintain an idle session timeout of 30 minutes.

  @negative @functional @ui @regression @tc-005
  Scenario: [TC-005] Submit value below minimum boundary
    Given Navigate to: User Authentication and Session Management
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Enter value one unit below the minimum allowed
    And with test data "-1 or value < minimum"
    Then Boundary error shown. Value rejected.
    When Enter valid data for all other mandatory fields (e.g., password)
    And with test data "{{validMandatoryInputs}}"
    Then Mandatory fields populated to isolate target field validation
    When Submit form and verify error handling response
    Then Boundary error shown. Value rejected.

  @negative @functional @ui @regression @tc-006
  Scenario: [TC-006] Submit value above maximum boundary
    Given Navigate to: User Authentication and Session Management
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Enter value one unit above the maximum allowed
    And with test data "value > maximum allowed"
    Then Boundary error shown. Value rejected.
    When Enter valid data for all other mandatory fields (e.g., password)
    And with test data "{{validMandatoryInputs}}"
    Then Mandatory fields populated to isolate target field validation
    When Submit form and verify error handling response
    Then Boundary error shown. Value rejected.

  @negative @functional @ui @regression @tc-007 @obsolete
  Scenario: [TC-007] Access without authentication
    Given Navigate to: User Authentication and Session Management
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Attempt action without logging in or with invalid token
    Then HTTP 401 returned. Redirect to login page.
    Then HTTP 401 returned. Redirect to login page.

  @negative @functional @ui @regression @tc-008
  Scenario: [TC-008] Access with insufficient permissions
    Given Navigate to: User Authentication and Session Management
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Log in as a role that lacks required permission
    And with test data "{{lowPrivilegeUserCredentials}}"
    Then HTTP 403 returned. Access denied message shown.
    Then HTTP 403 returned. Access denied message shown.

  @negative @functional @ui @regression @tc-009
  Scenario: [TC-009] Use expired session token
    Given Navigate to: User Authentication and Session Management
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Wait for session to expire, then perform action
    And with test data "{{expiredJwtToken}}"
    Then Session expiry message shown. Redirect to login.
    Then Session expiry message shown. Redirect to login.
