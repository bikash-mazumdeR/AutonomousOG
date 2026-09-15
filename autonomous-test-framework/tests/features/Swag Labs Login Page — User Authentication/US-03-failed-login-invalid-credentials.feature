Feature: Swag Labs Login Page — User Authentication — US-03 Failed Login — Invalid Credentials
  As a User
  I want to Receive a clear error message when submitting credentials that do not match any user record
  So that I understand why login failed and can correct my input

  @negative @ac-1 @ac-2 @ac-4 @smoke @regression @error-handling @tc-018
  Scenario: [TC-018] Invalid credentials show the credential mismatch error and keep user on login page
    Given the user is on the login page
    Then the Username input, Password input, and Login button are displayed
    When the user enters an unrecognised username and password and clicks Login
    And with test data "username: {{invalidUsername}}, password: {{invalidPassword}}"
    Then the error message "Epic sadface: Username and password do not match any user in this service" is displayed below the login form
    And the page URL does not change to "/inventory.html"
    And the user remains on the login page

  @negative @ac-3 @br-2 @regression @error-handling @tc-019
  Scenario: [TC-019] Credential mismatch error persists until the form is resubmitted
    Given the user is on the login page and has submitted invalid credentials
    Then the error message "Epic sadface: Username and password do not match any user in this service" is displayed
    When the user edits the username field without submitting the form
    Then the error message "Epic sadface: Username and password do not match any user in this service" remains visible

  @negative @ac-3 @br-2 @regression @error-handling @tc-020
  Scenario: [TC-020] Credential mismatch error is cleared when the page is refreshed
    Given the user is on the login page and has submitted invalid credentials
    Then the error message "Epic sadface: Username and password do not match any user in this service" is displayed
    When the user refreshes the login page
    Then the error message is no longer displayed
    And the login form is shown in its default state

  @negative @ac-3 @br-2 @regression @error-handling @tc-021
  Scenario: [TC-021] Credential mismatch error is cleared when the form is resubmitted
    Given the user is on the login page and has submitted invalid credentials
    Then the error message "Epic sadface: Username and password do not match any user in this service" is displayed
    When the user enters valid credentials and clicks Login
    And with test data "username: {{validUsername}}, password: {{validPassword}}"
    Then the error message is no longer displayed
    And the user is redirected to "/inventory.html"

  @negative @ac-1 @ac-5 @br-1 @regression @ui @error-handling @tc-022
  Scenario: [TC-022] Credential mismatch error is rendered as an inline HTML element not a browser alert
    Given the user is on the login page
    Then the Username input, Password input, and Login button are displayed
    When the user enters an unrecognised username and password and clicks Login
    And with test data "username: {{invalidUsername}}, password: {{invalidPassword}}"
    Then the error message "Epic sadface: Username and password do not match any user in this service" is rendered as an inline HTML element below the login form
    And no native browser alert dialog is displayed

  @negative @ac-6 @regression @security @tc-023
  Scenario: [TC-023] SQL injection payload in username field does not result in successful login or unhandled error
    Given the user is on the login page
    Then the Username input, Password input, and Login button are displayed
    When the user enters a SQL injection payload in the username field and a valid-format password and clicks Login
    And with test data "username: ' OR '1'='1, password: {{validPassword}}"
    Then the error message "Epic sadface: Username and password do not match any user in this service" is displayed below the login form
    And the page URL does not change to "/inventory.html"
    And no unhandled server error is displayed
