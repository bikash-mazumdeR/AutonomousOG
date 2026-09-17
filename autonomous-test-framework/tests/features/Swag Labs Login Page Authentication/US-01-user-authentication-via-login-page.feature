Feature: Swag Labs Login Page Authentication — US-01 User Authentication via Login Page
  As a user of the Swag Labs application
  I want to authenticate using my username and password credentials
  So that I can access the inventory catalog

  @positive @ac-1 @ac-2 @ac-17 @smoke @functional @ui @tc-001
  Scenario: [TC-001] Login page loads with all required elements at the documented URL
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user views the login page
    Then the page title is 'Swag Labs'
    And the Username text input field is displayed
    And the Password password input field is displayed
    And the Login submit button is displayed
    And the Credentials Info Box is displayed
    And the Swag Labs Logo is displayed

  @positive @ac-3 @ac-4 @br-6 @functional @tc-002
  Scenario: [TC-002] Login button is enabled and labelled correctly regardless of empty fields
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user views the Login button with the Username and Password fields empty
    Then the Login button is enabled
    And the Login button label is 'Login'
    And the Login button type is 'submit'

  @positive @ac-5 @br-1 @smoke @functional @tc-003
  Scenario: [TC-003] standard_user logs in with valid credentials and is redirected to inventory
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters 'standard_user' into the Username field and 'secret_sauce' into the Password field and clicks Login
    Then the URL is '/inventory.html'
    And the product list is displayed

  @positive @ac-6 @br-1 @functional @tc-004
  Scenario: [TC-004] problem_user logs in with valid credentials and is redirected to inventory
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters 'problem_user' into the Username field and 'secret_sauce' into the Password field and clicks Login
    Then the URL is '/inventory.html'
    And the product catalog page is displayed

  @positive @ac-7 @br-1 @functional @tc-005
  Scenario: [TC-005] visual_user logs in with valid credentials and is redirected to inventory
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters 'visual_user' into the Username field and 'secret_sauce' into the Password field and clicks Login
    Then the URL is '/inventory.html'
    And the product catalog page is displayed

  @negative @ac-8 @ac-28 @br-4 @functional @error-handling @tc-006
  Scenario: [TC-006] locked_out_user is denied access and sees the locked-out error message
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters 'locked_out_user' into the Username field and 'secret_sauce' into the Password field and clicks Login
    Then the error message 'Epic sadface: Sorry, this user has been locked out.' is displayed
    And the user remains on the login page
    And no redirect to '/inventory.html' occurs

  @negative @ac-9 @ac-27 @functional @error-handling @tc-007
  Scenario: [TC-007] Unrecognised credentials display the invalid credentials error message
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters '{{unregisteredUsername}}' into the Username field and '{{wrongPassword}}' into the Password field and clicks Login
    Then the error message 'Epic sadface: Username and password do not match any user in this service' is displayed
    And the user remains on the login page
    And no redirect to '/inventory.html' occurs

  @negative @ac-11 @ac-25 @functional @error-handling @tc-008
  Scenario: [TC-008] Submitting with an empty Username field displays the username required error
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user leaves the Username field empty and clicks Login
    Then the error message 'Epic sadface: Username is required' is displayed
    And the user remains on the login page

  @negative @ac-12 @ac-26 @functional @error-handling @tc-009
  Scenario: [TC-009] Submitting with a populated Username and empty Password displays the password required error
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters '{{validUsername}}' into the Username field and leaves the Password field empty and clicks Login
    Then the error message 'Epic sadface: Password is required' is displayed
    And the user remains on the login page

  @negative @ac-10 @ac-29 @functional @error-handling @tc-010
  Scenario: [TC-010] Invalid credentials error message persists until the form is resubmitted
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters '{{unregisteredUsername}}' into the Username field and '{{wrongPassword}}' into the Password field and clicks Login
    Then the error message 'Epic sadface: Username and password do not match any user in this service' is displayed
    When the user does not resubmit the form and does not refresh the page
    Then the error message 'Epic sadface: Username and password do not match any user in this service' is still displayed

  @edge @ac-13 @ac-25 @br-3 @functional @error-handling @tc-011
  Scenario: [TC-011] Username field containing only whitespace is trimmed and triggers the username required error
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters whitespace-only characters into the Username field and 'secret_sauce' into the Password field and clicks Login
    Then the error message 'Epic sadface: Username is required' is displayed
    And the user remains on the login page

  @edge @ac-14 @ac-22 @br-2 @functional @security @tc-012
  Scenario: [TC-012] Username field is case-sensitive and rejects a differently-cased valid username
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters 'Standard_User' into the Username field and 'secret_sauce' into the Password field and clicks Login
    Then the error message 'Epic sadface: Username and password do not match any user in this service' is displayed
    And the user remains on the login page

  @edge @ac-15 @ac-19 @functional @ui @tc-013
  Scenario: [TC-013] Password field masks input and accepts pasted keyboard input
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters 'secret_sauce' into the Password field
    Then each character in the Password field is masked as a dot or asterisk
    When the user pastes '{{pastedPasswordValue}}' into the Password field
    Then the pasted value is accepted and each character remains masked

  @negative @ac-20 @ac-21 @functional @ui @error-handling @tc-014
  Scenario: [TC-014] Error message is rendered in the DOM above the Password field with a red shade
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user leaves the Username field empty and clicks Login
    Then the error message container is part of the DOM and is not a browser-native alert dialog with the text "Epic sadface: Username is required"
    And the error message container is positioned above the Password text box
    And the error message container is rendered in a red shade

  @edge @ac-16 @functional @ui @tc-015
  Scenario: [TC-015] Credentials Info Box lists all accepted usernames and the shared password hint
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user views the Credentials Info Box
    Then the Credentials Info Box displays 'Accepted usernames are:' followed by 'standard_user', 'locked_out_user', 'problem_user', 'performance_glitch_user', 'error_user', and 'visual_user'
    And the Credentials Info Box displays 'Password for all users:' followed by 'secret_sauce'

  @positive @ac-18 @ui @tc-016
  Scenario: [TC-016] Login form is centered on the page
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user views the login form container
    Then the login form is horizontally centered on the page

  @positive @ac-23 @br-5 @functional @tc-017
  Scenario: [TC-017] Test user accounts use the shared password and contain no personal information
    Given the user navigates to https://www.saucedemo.com/
    Then the login page is displayed
    When the user views the Credentials Info Box
    Then the Credentials Info Box lists only the documented test usernames and shows 'secret_sauce' as the password for all users
    And no personally identifiable information is present in the displayed credentials

  @negative @ac-24 @accessibility @tc-018
  Scenario: [TC-018] Error message is announced to screen readers when invalid credentials are submitted
    Given the user is on the login page at https://www.saucedemo.com/
    Then the login page is displayed
    When the user enters '{{invalidUsername}}' in the Username field and 'secret_sauce' in the Password field and clicks Login
    Then the error message container has an accessible role or aria attribute that exposes it to screen readers
