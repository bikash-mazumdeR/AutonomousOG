Feature: Swag Labs Login Page — User Authentication — US-02 Failed Authentication — Invalid Credentials
  As a user
  I want to Receive a clear error message when submitting incorrect credentials
  So that Understand that login failed and remain on the login page to retry

  @positive @ac-1 @ac-2 @ac-4 @ac-5 @ac-6 @br-2 @smoke @regression @functional @ui @error-handling @tc-018 @held
  Scenario: [TC-018] Invalid credentials show the username-password mismatch error and keep the user on the login page
    Given the user is on the login page
    Then the Username field, Password field, and Login button are displayed
    When the user enters an unrecognised username and password and clicks Login
    And with test data "username: {{invalidUsername}}, password: {{invalidPassword}}"
    Then the error message "Epic sadface: Username and password do not match any user in this service" is displayed
    And the error message is displayed below the login form or in an alert box
    And the error message container is styled with a red background (recommended value: #E2453C)
    And an error icon is displayed alongside the error message
    And the user remains on the login page and is not redirected to the inventory page

  @positive @ac-3 @br-1 @regression @functional @error-handling @tc-019
  Scenario: [TC-019] Invalid-credentials error persists until the form is resubmitted
    Given the user is on the login page
    Then the Username field, Password field, and Login button are displayed
    When the user enters an unrecognised username and password and clicks Login
    And with test data "username: {{invalidUsername}}, password: {{invalidPassword}}"
    Then the error message "Epic sadface: Username and password do not match any user in this service" is displayed
    When the user does not resubmit the form and does not refresh the page
    Then the error message "Epic sadface: Username and password do not match any user in this service" is still displayed

  @positive @ac-3 @br-1 @regression @functional @error-handling @tc-020
  Scenario: [TC-020] Invalid-credentials error clears when the form is resubmitted with valid credentials
    Given the user is on the login page
    Then the Username field, Password field, and Login button are displayed
    When the user enters an unrecognised username and password and clicks Login
    And with test data "username: {{invalidUsername}}, password: {{invalidPassword}}"
    Then the error message "Epic sadface: Username and password do not match any user in this service" is displayed
    When the user enters valid credentials and clicks Login
    And with test data "username: standard_user, password: secret_sauce"
    Then the error message "Epic sadface: Username and password do not match any user in this service" is no longer displayed
    And the user is redirected to the inventory page

  @positive @ac-7 @regression @accessibility @tc-021
  Scenario: [TC-021] Invalid-credentials error message is announced to screen readers when it appears
    Given the user is on the login page
    Then the Username field, Password field, and Login button are displayed
    When the user enters an unrecognised username and password and clicks Login
    And with test data "username: {{invalidUsername}}, password: {{invalidPassword}}"
    Then Epic sadface: Username and password do not match any user in this service

  @positive @ac-8 @br-3 @regression @functional @error-handling @tc-022
  Scenario: [TC-022] Submitting with an empty username shows the username required error
    Given the user is on the login page
    Then the Username field, Password field, and Login button are displayed
    When the user leaves the Username field empty, enters a password, and clicks Login
    And with test data "password: {{validPassword}}"
    Then an error is displayed indicating the username field must not be empty
    And the user remains on the login page

  @positive @ac-9 @br-3 @regression @functional @error-handling @tc-023
  Scenario: [TC-023] Submitting with an empty password shows the password required error
    Given the user is on the login page
    Then the Username field, Password field, and Login button are displayed
    When the user enters a username, leaves the Password field empty, and clicks Login
    And with test data "username: {{validUsername}}"
    Then an error is displayed indicating the password field must not be empty
    And the user remains on the login page
