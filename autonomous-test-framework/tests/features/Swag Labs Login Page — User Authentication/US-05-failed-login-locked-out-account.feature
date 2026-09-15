Feature: Swag Labs Login Page — User Authentication — US-05 Failed Login — Locked Out Account
  As a locked_out_user
  I want to Receive a specific locked-out error message when attempting to log in with a locked account
  So that I understand my account is locked and can seek support

  @negative @ac-1 @ac-2 @ac-4 @br-1 @smoke @regression @error-handling @tc-029
  Scenario: [TC-029] Locked out user login shows the locked-out error message and stays on login page
    Given the user is on the login page at "https://www.saucedemo.com"
    Then the Username input, Password input, and Login button are displayed
    When the user enters username "locked_out_user" and password "secret_sauce" and clicks Login
    Then the error message "Epic sadface: Sorry, this user has been locked out." is displayed below the login form
    And the current URL remains "https://www.saucedemo.com" and does not redirect to "/inventory.html"
    And the user remains on the login page

  @negative @ac-3 @regression @ui @error-handling @tc-030
  Scenario: [TC-030] Locked-out error message is rendered as an inline HTML element below the login form
    Given the user is on the login page at "https://www.saucedemo.com"
    Then the Username input, Password input, and Login button are displayed
    When the user enters username "locked_out_user" and password "secret_sauce" and clicks Login
    Then the error message "Epic sadface: Sorry, this user has been locked out." is rendered as an inline HTML element positioned below the login form

  @negative @ac-4 @br-1 @regression @functional @tc-031
  Scenario: [TC-031] Locked out user is not granted access to the inventory page
    Given the user is on the login page at "https://www.saucedemo.com"
    Then the Username input, Password input, and Login button are displayed
    When the user enters username "locked_out_user" and password "secret_sauce" and clicks Login
    Then the page does not navigate to "/inventory.html"
    And the inventory page content is not displayed
