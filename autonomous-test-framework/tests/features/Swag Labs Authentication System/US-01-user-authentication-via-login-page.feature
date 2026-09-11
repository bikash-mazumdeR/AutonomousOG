Feature: Swag Labs Authentication System
  As a User,
  I want to Authenticate using credentials
  So that Access the inventory catalog.

  Background:
    Given the user is on the login page

  @positive @functional @ui @security @smoke @regression @tc-001
  Scenario: [TC-001] Successful login with valid credentials redirects to inv
    Given Navigate to the feature: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Successful login with valid credentials redirects to /inventory.html
    And with test data "{{validTestData}}"
    Then System confirms: Successful login with valid credentials redirects to /inventory.html
    Then System confirms: Successful login with valid credentials redirects to /inventory.html

  @positive @functional @ui @security @smoke @regression @tc-002
  Scenario: [TC-002] Invalid credentials display error: Epic sadface: Usernam
    Given Navigate to the feature: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Invalid credentials display error: 'Epic sadface: Username and password do not m
    And with test data "{{validPassword}}"
    Then System confirms: Invalid credentials display error: 'Epic sadface: Username and password do not match any user in this service'
    Then System confirms: Invalid credentials display error: 'Epic sadface: Username and password do not match any user in this service'

  @positive @functional @ui @security @smoke @regression @tc-003
  Scenario: [TC-003] Locked out user displays error: Epic sadface: Sorry thi
    Given Navigate to the feature: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Locked out user displays error: 'Epic sadface: Sorry, this user has been locked
    And with test data "{{validTestData}}"
    Then System confirms: Locked out user displays error: 'Epic sadface: Sorry, this user has been locked out.'
    Then System confirms: Locked out user displays error: 'Epic sadface: Sorry, this user has been locked out.'

  @positive @functional @ui @security @smoke @regression @tc-004
  Scenario: [TC-004] Username field is case-sensitive and trims whitespace
    Given Navigate to the feature: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Username field is case-sensitive and trims whitespace
    And with test data "{{validName}}"
    Then System confirms: Username field is case-sensitive and trims whitespace
    Then System confirms: Username field is case-sensitive and trims whitespace

  @positive @functional @ui @security @smoke @regression @tc-005
  Scenario: [TC-005] Password field masks input characters
    Given Navigate to the feature: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Password field masks input characters
    And with test data "{{validPassword}}"
    Then System confirms: Password field masks input characters
    Then System confirms: Password field masks input characters

  @positive @functional @ui @security @smoke @regression @tc-006
  Scenario: [TC-006] Login button is always enabled and triggers submission
    Given Navigate to the feature: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Login button is always enabled and triggers submission
    And with test data "{{validTestData}}"
    Then System confirms: Login button is always enabled and triggers submission
    Then System confirms: Login button is always enabled and triggers submission

  @positive @functional @ui @security @smoke @regression @tc-007
  Scenario: [TC-007] System enforces 30-minute idle session timeout
    Given Navigate to the feature: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: System enforces 30-minute idle session timeout
    And with test data "{{validTestData}}"
    Then System confirms: System enforces 30-minute idle session timeout
    Then System confirms: System enforces 30-minute idle session timeout

  @positive @functional @ui @security @smoke @regression @tc-008
  Scenario: [TC-008] All login traffic is encrypted via TLS 12
    Given Navigate to the feature: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: All login traffic is encrypted via TLS 1.2+
    And with test data "{{validTestData}}"
    Then System confirms: All login traffic is encrypted via TLS 1.2+
    Then System confirms: All login traffic is encrypted via TLS 1.2+

  @positive @functional @ui @security @smoke @regression @tc-009
  Scenario: [TC-009] Page is WCAG 21 Level AA compliant
    Given Navigate to the feature: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Page is WCAG 2.1 Level AA compliant
    And with test data "{{validTestData}}"
    Then System confirms: Page is WCAG 2.1 Level AA compliant
    Then System confirms: Page is WCAG 2.1 Level AA compliant

  @positive @functional @ui @security @smoke @regression @tc-010
  Scenario: [TC-010] Error messages are displayed in red (E2453C) and announc
    Given Navigate to the feature: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Error messages are displayed in red (#E2453C) and announced to screen readers
    And with test data "{{validTestData}}"
    Then System confirms: Error messages are displayed in red (#E2453C) and announced to screen readers
    Then System confirms: Error messages are displayed in red (#E2453C) and announced to screen readers

  @positive @functional @ui @security @smoke @regression @tc-011
  Scenario: [TC-011] Responsive layout supports viewports from 320px to 2560px
    Given Navigate to the feature: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Responsive layout supports viewports from 320px to 2560px
    And with test data "{{validTestData}}"
    Then System confirms: Responsive layout supports viewports from 320px to 2560px
    Then System confirms: Responsive layout supports viewports from 320px to 2560px

  @positive @functional @ui @security @smoke @regression @tc-012
  Scenario: [TC-012] System implements CSRF protection and parameterized queries
    Given Navigate to the feature: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: System implements CSRF protection and parameterized queries
    And with test data "{{validTestData}}"
    Then System confirms: System implements CSRF protection and parameterized queries
    Then System confirms: System implements CSRF protection and parameterized queries

  @negative @functional @ui @security @smoke @regression @tc-013
  Scenario: [TC-013] Submit with empty mandatory field
    Given Navigate to: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Leave required field blank and submit
    Then Inline validation error shown. Form not submitted.
    Then Inline validation error shown. Form not submitted.

  @negative @functional @ui @security @smoke @regression @tc-014
  Scenario: [TC-014] Submit value below minimum boundary
    Given Navigate to: User Authentication via Login Page
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

  @negative @functional @ui @security @smoke @regression @tc-015
  Scenario: [TC-015] Submit value above maximum boundary
    Given Navigate to: User Authentication via Login Page
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

  @negative @functional @ui @security @smoke @regression @tc-016
  Scenario: [TC-016] Access without authentication
    Given Navigate to: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Attempt action without logging in or with invalid token
    Then HTTP 401 returned. Redirect to login page.
    Then HTTP 401 returned. Redirect to login page.

  @negative @functional @ui @security @smoke @regression @tc-017
  Scenario: [TC-017] Access with insufficient permissions
    Given Navigate to: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Log in as a role that lacks required permission
    And with test data "{{lowPrivilegeUserCredentials}}"
    Then HTTP 403 returned. Access denied message shown.
    Then HTTP 403 returned. Access denied message shown.

  @negative @functional @ui @security @smoke @regression @tc-018
  Scenario: [TC-018] Enter SQL injection payload
    Given Navigate to: User Authentication via Login Page
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

  @negative @functional @ui @security @smoke @regression @tc-019
  Scenario: [TC-019] Use expired session token
    Given Navigate to: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature is accessible
    When Wait for session to expire, then perform action
    And with test data "{{expiredJwtToken}}"
    Then Session expiry message shown. Redirect to login.
    Then Session expiry message shown. Redirect to login.

  @edge @functional @ui @security @smoke @regression @tc-020
  Scenario: [TC-020] Exact minimum boundary value
    Given Navigate to: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature loads correctly
    When Enter exact minimum allowed value
    And with test data "{{exactMinimumValue}}"
    Then System accepts exact minimum. No error shown.
    Then System shows appropriate message or accepts valid boundary value without error

  @edge @functional @ui @security @smoke @regression @tc-021
  Scenario: [TC-021] Exact maximum boundary value
    Given Navigate to: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature loads correctly
    When Enter exact maximum allowed value
    And with test data "{{exactMaximumValue}}"
    Then System accepts exact maximum. No error shown.
    Then System shows appropriate message or accepts valid boundary value without error

  @edge @functional @ui @security @smoke @regression @tc-022
  Scenario: [TC-022] Submit extremely long string input
    Given Navigate to: User Authentication via Login Page
    And with test data "{{validBaseURL}}"
    Then Feature loads correctly
    When Enter 1000+ character string in text field
    And with test data "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA (1000 characters)"
    Then System truncates or rejects long input. No crash. No stack overflow.
    Then System shows appropriate message or accepts valid boundary value without error
