Feature: Swag Labs Login Page — User Authentication — US-03 Failed Authentication — Locked Out Account
  As a locked_out_user
  I want to Receive a specific locked-out error message when attempting to log in with a locked account
  So that Understand that the account is locked and be directed to contact support

  @positive @ac-1 @ac-2 @ac-3 @br-1 @br-2 @smoke @regression @functional @error-handling @tc-024
  Scenario: [TC-024] Locked out user login attempt displays the locked-out error message and remains on login page
    Given the user is on the login page
    Then the Username input, Password input, and Login button are displayed
    When the user enters 'locked_out_user' as the username and 'secret_sauce' as the password and clicks Login
    Then the error message "Epic sadface: Sorry, this user has been locked out." is displayed
    And the user remains on the login page and is not redirected to the inventory page

  @positive @ac-4 @regression @ui @error-handling @tc-025 @obsolete
  Scenario: [TC-025] Locked out error message is displayed in an alert container with red styling and an error icon
    Given the user is on the login page
    Then the Username input, Password input, and Login button are displayed
    When the user enters 'locked_out_user' as the username and 'secret_sauce' as the password and clicks Login
    Then the error message "Epic sadface: Sorry, this user has been locked out." is displayed in an alert container styled with a red background and an error icon below the login form

  @positive @ac-5 @regression @accessibility @error-handling @tc-026 @obsolete
  Scenario: [TC-026] Locked out error message is announced to screen readers when it appears
    Given the user is on the login page
    Then the Username input, Password input, and Login button are displayed
    When the user enters 'locked_out_user' as the username and 'secret_sauce' as the password and clicks Login
    Then the error message "Epic sadface: Sorry, this user has been locked out." is rendered in a DOM element with an appropriate ARIA role or live region attribute so that screen readers announce it on appearance
