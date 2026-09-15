Feature: Swag Labs Login Page — User Authentication — US-04 Failed Login — Empty Field Validation
  As a User
  I want to Receive specific error messages when submitting the login form with one or both fields empty
  So that I know exactly which field needs to be filled in

  @positive @ac-6 @smoke @regression @functional @ui @tc-024
  Scenario: [TC-024] Login button remains enabled when both username and password fields are empty
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user views the login form without entering any credentials
    Then the Login button is enabled and clickable

  @negative @ac-1 @ac-5 @br-2 @regression @error-handling @tc-025
  Scenario: [TC-025] Submitting login with both fields empty shows username required error
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user clicks the Login button without entering a username or password
    Then the inline error message "Epic sadface: Username is required" is displayed below the login form
    And the user remains on the login page

  @negative @ac-2 @ac-5 @br-2 @regression @error-handling @tc-026
  Scenario: [TC-026] Submitting login with username empty and password populated shows username required error
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user enters a password and clicks Login without entering a username
    And with test data "{{validPassword}}"
    Then the inline error message "Epic sadface: Username is required" is displayed below the login form
    And the user remains on the login page

  @negative @ac-3 @ac-5 @regression @error-handling @tc-027
  Scenario: [TC-027] Submitting login with username populated and password empty shows password required error
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user enters a username and clicks Login without entering a password
    And with test data "{{validUsername}}"
    Then the inline error message "Epic sadface: Password is required" is displayed below the login form
    And the user remains on the login page

  @negative @ac-4 @ac-5 @br-1 @br-2 @regression @functional @error-handling @tc-028
  Scenario: [TC-028] Submitting login with whitespace-only username treats it as empty and shows username required error
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user enters a whitespace-only value in the username field
    Then the username field is populated with whitespace only
    When the user enters a valid password and clicks Login
    And with test data "{{validPassword}}"
    Then the inline error message "Epic sadface: Username is required" is displayed below the login form
    And the user remains on the login page
