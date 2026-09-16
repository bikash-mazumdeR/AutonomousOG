Feature: Swag Labs Login Page — US-01 User Authentication via Login Page
  As a user of the Swag Labs application
  I want to authenticate using my username and password credentials
  So that I can access the inventory catalog

  @positive @ac-1 @ac-2 @ac-3 @ac-4 @ac-23 @ac-24 @smoke @functional @ui @tc-001
  Scenario: [TC-001] Login page loads with all required elements visible
    Given the user navigates to https://www.saucedemo.com/
    Then the page title is 'Swag Labs'
    And the Username input, Password input, Login button, Credentials Info Box, and Swag Labs Logo are displayed
    And the login form is centered on the page
    When the user observes the Login button
    Then the Login button label is 'Login' and its type is submit
    And the Login button is enabled

  @positive @ac-5 @ac-6 @br-1 @smoke @functional @tc-002
  Scenario: [TC-002] standard_user logs in with valid credentials and reaches the inventory page
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters username 'standard_user' and password 'secret_sauce' and clicks Login
    Then the URL is '/inventory.html'
    And the product list is displayed

  @positive @ac-7 @br-1 @functional @tc-003
  Scenario: [TC-003] problem_user logs in and is redirected to the inventory page
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters username 'problem_user' and password 'secret_sauce' and clicks Login
    Then the URL is '/inventory.html'

  @positive @ac-9 @br-1 @functional @tc-004
  Scenario: [TC-004] visual_user logs in and is redirected to the inventory page
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters username 'visual_user' and password 'secret_sauce' and clicks Login
    Then the URL is '/inventory.html'

  @positive @ac-3 @ac-4 @br-6 @functional @ui @tc-005
  Scenario: [TC-005] Login button is enabled and labelled Login when both fields are empty
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user observes the Login button with both Username and Password fields empty
    Then the Login button is enabled
    And the Login button label is 'Login' and its type is submit

  @positive @ac-14 @ac-17 @ac-18 @ac-25 @functional @ui @tc-006
  Scenario: [TC-006] Password field masks input and accepts pasted value alongside valid username characters
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user types 'standard_user' into the Username field and pastes '{{validPassword}}' into the Password field
    Then all characters in the Password field are masked as dots or asterisks

  @negative @ac-10 @ac-13 @br-5 @functional @error-handling @tc-007
  Scenario: [TC-007] locked_out_user sees locked-out error and remains on the login page
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters username 'locked_out_user' and password 'secret_sauce' and clicks Login
    Then the error message 'Epic sadface: Sorry, this user has been locked out.' is displayed
    And the user remains on the login page
    When the user does not resubmit or refresh the page
    Then the error message 'Epic sadface: Sorry, this user has been locked out.' is still displayed

  @negative @ac-11 @ac-12 @functional @error-handling @tc-008
  Scenario: [TC-008] Invalid credentials display an error that persists until resubmission
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters username '{{invalidUsername}}' and password '{{invalidPassword}}' and clicks Login
    Then the error message 'Epic sadface: Username and password do not match any user in this service' is displayed
    And the user remains on the login page
    When the user does not resubmit or refresh the page
    Then the error message 'Epic sadface: Username and password do not match any user in this service' is still displayed

  @negative @ac-19 @ac-21 @ac-22 @functional @ui @error-handling @tc-009
  Scenario: [TC-009] Clicking Login with empty Username shows the username-required error
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user leaves the Username field empty, enters '{{validPassword}}' in the Password field, and clicks Login
    Then the error message 'Epic sadface: Username is required' is displayed below the login form or in an alert box
    And the error message container is styled with colour #E2453C

  @negative @ac-20 @ac-21 @ac-22 @functional @ui @error-handling @tc-010
  Scenario: [TC-010] Clicking Login with empty Password shows the password-required error
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters 'standard_user' in the Username field, leaves the Password field empty, and clicks Login
    Then the error message 'Epic sadface: Password is required' is displayed below the login form or in an alert box
    And the error message container is styled with colour #E2453C

  @negative @ac-11 @ac-15 @br-3 @functional @tc-011
  Scenario: [TC-011] Username entered in wrong case is rejected with invalid-credentials error
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters username 'Standard_User' and password 'secret_sauce' and clicks Login
    Then the error message 'Epic sadface: Username and password do not match any user in this service' is displayed
    And the user remains on the login page

  @negative @ac-16 @ac-19 @functional @error-handling @tc-012
  Scenario: [TC-012] Username field containing only whitespace is treated as empty and shows username-required error
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters only whitespace characters in the Username field, enters 'secret_sauce' in the Password field, and clicks Login
    Then the error message 'Epic sadface: Username is required' is displayed

  @negative @ac-12 @ac-13 @functional @tc-013
  Scenario: [TC-013] Error message clears when the page is refreshed
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters username '{{invalidUsername}}' and password '{{invalidPassword}}' and clicks Login
    Then the error message 'Epic sadface: Username and password do not match any user in this service' is displayed
    When the user refreshes the page
    Then the error message is no longer displayed
    And the login form is in a clean state

  @negative @ac-26 @accessibility @error-handling @tc-014
  Scenario: [TC-014] Error message element is marked up for screen reader announcement
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user leaves the Username field empty, enters '{{validPassword}}' in the Password field, and clicks Login
    Then the error message 'Epic sadface: Username is required' is displayed in a container that has an aria-live or role='alert' attribute
