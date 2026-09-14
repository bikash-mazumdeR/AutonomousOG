Feature: Swag Labs Login Page Authentication — US-02 Authentication Failures and Input Validation
  As a User
  I want to Receive clear, inline error messages when authentication fails or inputs are invalid
  So that Understand why authentication failed and correct my credentials

  @negative @ac-1 @br-1 @br-2 @regression @functional @ui @error-handling @tc-009
  Scenario: [TC-009] Locked out user login displays locked out error message below the form
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user enters username "locked_out_user" and password "secret_sauce" and clicks login
    Then the inline HTML error message "Epic sadface: Sorry, this user has been locked out." is displayed below the form
    And no error icon asset is displayed within the error message container

  @negative @ac-2 @br-1 @br-2 @regression @functional @ui @error-handling @tc-010
  Scenario: [TC-010] Invalid credentials login displays mismatch error message below the form
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user enters username "{{invalidUsername}}" and password "{{invalidPassword}}" and clicks login
    Then the inline HTML error message "Epic sadface: Username and password do not match any user in this service" is displayed below the form
    And no error icon asset is displayed within the error message container

  @negative @ac-3 @br-1 @br-2 @regression @functional @ui @error-handling @tc-011
  Scenario: [TC-011] Submitting empty credentials displays username required error message
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user clicks the login button with both username and password fields empty
    Then the inline HTML error message "Epic sadface: Username is required" is displayed below the form
    And no error icon asset is displayed within the error message container

  @negative @ac-3 @br-1 @br-2 @regression @functional @ui @error-handling @tc-012
  Scenario: [TC-012] Submitting empty username with populated password displays username required error message
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user enters a password and clicks login without entering a username
    And with test data "{{validPassword}}"
    Then the inline HTML error message "Epic sadface: Username is required" is displayed below the form
    And no error icon asset is displayed within the error message container

  @negative @ac-4 @br-1 @br-2 @regression @functional @ui @error-handling @tc-013
  Scenario: [TC-013] Submitting populated username with empty password displays password required error message
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user enters a username and clicks login without entering a password
    And with test data "{{validUsername}}"
    Then the inline HTML error message "Epic sadface: Password is required" is displayed below the form
    And no error icon asset is displayed within the error message container

  @edge @ac-3 @br-3 @regression @functional @ui @tc-014
  Scenario: [TC-014] Error message persists until the page is refreshed
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user clicks the login button with both username and password fields empty
    Then the inline HTML error message "Epic sadface: Username is required" is displayed below the form
    When the user refreshes the page
    Then the error message is no longer displayed

  @edge @ac-3 @ac-4 @br-3 @regression @functional @ui @tc-015
  Scenario: [TC-015] Error message persists until the form is resubmitted with different inputs
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user clicks the login button with both username and password fields empty
    Then the inline HTML error message "Epic sadface: Username is required" is displayed below the form
    When the user enters a username and clicks login without entering a password
    And with test data "{{validUsername}}"
    Then the inline HTML error message "Epic sadface: Password is required" is displayed below the form

  @edge @ac-1 @regression @functional @ui @tc-016
  Scenario: [TC-016] Username with leading and trailing whitespace is trimmed before validation
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user enters username "  locked_out_user  " and password "secret_sauce" and clicks login
    Then the inline HTML error message "Epic sadface: Sorry, this user has been locked out." is displayed below the form
