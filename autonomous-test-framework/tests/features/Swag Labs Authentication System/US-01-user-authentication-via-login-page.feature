Feature: Swag Labs Authentication System — US-01 User Authentication via Login Page
  As a User
  I want to Authenticate using credentials to access the inventory catalog
  So that Secure access to the purchase ecosystem

  @positive @ac-1 @smoke @regression @functional @tc-001
  Scenario: [TC-001] Successful login with valid credentials
    Given the user is on the login page
    Then the login form is displayed
    When the user enters a valid username and the password "secret_sauce"
    And with test data "{{validUsername}}"
    Then the user is redirected to "/inventory.html"

  @positive @ac-6 @regression @functional @tc-002
  Scenario: [TC-002] Successful login for performance glitch user within threshold
    Given the user is on the login page
    Then the login form is displayed
    When the user enters the username "performance_glitch_user" and the password "secret_sauce"
    Then the inventory page is displayed within 5000 ms

  @positive @ac-7 @regression @functional @tc-003
  Scenario: [TC-003] Successful login for error user displays compromise dialog
    Given the user is on the login page
    Then the login form is displayed
    When the user enters the username "error_user" and the password "secret_sauce"
    Then the dialog with the message "credentials are compromise" is displayed

  @positive @ac-8 @regression @ui @tc-004
  Scenario: [TC-004] Successful login for visual user displays identical product images
    Given the user is on the login page
    Then the login form is displayed
    When the user enters the username "visual_user" and the password "secret_sauce"
    Then the products are displayed with identical images

  @positive @ac-8 @regression @ui @tc-005
  Scenario: [TC-005] Successful login for problem user displays identical product images
    Given the user is on the login page
    Then the login form is displayed
    When the user enters the username "problem_user" and the password "secret_sauce"
    Then the products are displayed with identical images

  @positive @ac-9 @regression @ui @tc-006
  Scenario: [TC-006] Login button remains enabled regardless of form state
    Given the user is on the login page
    Then the login form is displayed
    When the user leaves the username and password fields empty
    Then the Login button is enabled

  @positive @ac-11 @regression @ui @security @tc-007
  Scenario: [TC-007] Password field masks input characters
    Given the user is on the login page
    Then the login form is displayed
    When the user enters characters into the password field
    And with test data "{{anyPassword}}"
    Then the password field displays the input as dots or asterisks

  @positive @ac-12 @regression @ui @tc-008
  Scenario: [TC-008] Login page supports responsive layouts
    Given the user is on the login page
    Then the login form is displayed
    When the viewport is resized between 320px and 2560px
    Then the login form layout adjusts to the viewport width
