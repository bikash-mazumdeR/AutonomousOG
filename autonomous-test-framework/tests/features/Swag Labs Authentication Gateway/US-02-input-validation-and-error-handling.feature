Feature: Swag Labs Authentication Gateway
  As a user of the application,
  I want to Ensure the system behaves correctly according to the specific test user profile used for login.
  So that access protected functionality.

  Background:
    Given the user is on the login page

  @positive @functional @ui @regression @tc-010
  Scenario: [TC-010] [error-handling] Given empty values in both Username and
    Given Navigate to the feature: Input Validation and Error Handling
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@error-handling] Given empty values in both Username and Password fields, or an
    And with test data "{{validPassword}}"
    Then System confirms: [@error-handling] Given empty values in both Username and Password fields, or an empty Username field with any Password, when the user clicks Login, display the error message: "Epic sadface: Username is required".
    Then System confirms: [@error-handling] Given empty values in both Username and Password fields, or an empty Username field with any Password, when the user clicks Login, display the error message: "Epic sadface: Username is required".

  @positive @functional @ui @regression @tc-011
  Scenario: [TC-011] [error-handling] Given a non-empty Username and an empty
    Given Navigate to the feature: Input Validation and Error Handling
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@error-handling] Given a non-empty Username and an empty Password field, when t
    And with test data "{{validPassword}}"
    Then System confirms: [@error-handling] Given a non-empty Username and an empty Password field, when the user clicks Login, display the error message: "Epic sadface: Password is required".
    Then System confirms: [@error-handling] Given a non-empty Username and an empty Password field, when the user clicks Login, display the error message: "Epic sadface: Password is required".

  @positive @functional @ui @regression @tc-012
  Scenario: [TC-012] [error-handling] Given credentials that do not match any
    Given Navigate to the feature: Input Validation and Error Handling
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@error-handling] Given credentials that do not match any active user record, wh
    And with test data "{{validPassword}}"
    Then System confirms: [@error-handling] Given credentials that do not match any active user record, when the user clicks Login, display the error message: "Epic sadface: Username and password do not match any user in this service".
    Then System confirms: [@error-handling] Given credentials that do not match any active user record, when the user clicks Login, display the error message: "Epic sadface: Username and password do not match any user in this service".

  @positive @functional @ui @regression @tc-013
  Scenario: [TC-013] [error-handling] Given the username locked_out_user an
    Given Navigate to the feature: Input Validation and Error Handling
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@error-handling] Given the username 'locked_out_user' and password 'secret_sauc
    And with test data "{{validPassword}}"
    Then System confirms: [@error-handling] Given the username 'locked_out_user' and password 'secret_sauce', when the user clicks Login, display the error message: "Epic sadface: Sorry, this user has been locked out."
    Then System confirms: [@error-handling] Given the username 'locked_out_user' and password 'secret_sauce', when the user clicks Login, display the error message: "Epic sadface: Sorry, this user has been locked out."

  @positive @functional @ui @regression @tc-014
  Scenario: [TC-014] [error-handling] For all failed authentication scenarios
    Given Navigate to the feature: Input Validation and Error Handling
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: [@error-handling] For all failed authentication scenarios, the user must remain
    And with test data "{{validTestData}}"
    Then [@error-handling] For all failed authentication scenarios, the user must remain on the login page, no session token must be created in Local Storage, and the error banner must display in red (#E2453C) with an error icon until form resubmission or page reload.
    Then System confirms: [@error-handling] For all failed authentication scenarios, the user must remain on the login page, no session token must be created in Local Storage, and the error banner must display in red (#E2453C) with an error icon until form resubmission or page reload.
    Then Changes are retained after page reload

  @negative @functional @ui @regression @tc-015
  Scenario: [TC-015] Submit with empty mandatory field
    Given Navigate to: Input Validation and Error Handling
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Leave required field blank and submit
    Then Inline validation error shown. Form not submitted.
    Then Inline validation error shown. Form not submitted.

  @negative @functional @ui @regression @tc-016
  Scenario: [TC-016] Submit with invalid format
    Given Navigate to: Input Validation and Error Handling
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Enter data in incorrect format and submit
    And with test data "invalidemail / 12345abc"
    Then Format validation error message displayed.
    When Enter valid data for all other mandatory fields (e.g., password)
    And with test data "{{validMandatoryInputs}}"
    Then Mandatory fields populated to isolate target field validation
    When Submit form and verify error handling response
    Then Format validation error message displayed.

  @negative @functional @ui @regression @tc-017 @obsolete
  Scenario: [TC-017] Submit value below minimum boundary
    Given Navigate to: Input Validation and Error Handling
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

  @negative @functional @ui @regression @tc-018 @obsolete
  Scenario: [TC-018] Submit value above maximum boundary
    Given Navigate to: Input Validation and Error Handling
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

  @negative @functional @ui @regression @tc-019 @obsolete
  Scenario: [TC-019] Access without authentication
    Given Navigate to: Input Validation and Error Handling
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Attempt action without logging in or with invalid token
    Then HTTP 401 returned. Redirect to login page.
    Then HTTP 401 returned. Redirect to login page.

  @negative @functional @ui @regression @tc-020 @obsolete
  Scenario: [TC-020] Access with insufficient permissions
    Given Navigate to: Input Validation and Error Handling
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Log in as a role that lacks required permission
    And with test data "{{lowPrivilegeUserCredentials}}"
    Then HTTP 403 returned. Access denied message shown.
    Then HTTP 403 returned. Access denied message shown.

  @negative @functional @ui @regression @tc-021
  Scenario: [TC-021] Enter SQL injection payload
    Given Navigate to: Input Validation and Error Handling
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

  @negative @functional @ui @regression @tc-022 @obsolete
  Scenario: [TC-022] Enter XSS payload in text field
    Given Navigate to: Input Validation and Error Handling
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

  @negative @functional @ui @regression @tc-023 @obsolete
  Scenario: [TC-023] Use expired session token
    Given Navigate to: Input Validation and Error Handling
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Wait for session to expire, then perform action
    And with test data "{{expiredJwtToken}}"
    Then Session expiry message shown. Redirect to login.
    Then Session expiry message shown. Redirect to login.
