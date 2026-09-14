Feature: Swag Labs Login Page Authentication — US-01 Successful User Authentication and Profile Handling
  As a User
  I want to Authenticate using valid credentials
  So that Access the inventory catalog with appropriate profile behaviors

  @positive @ac-1 @br-1 @smoke @regression @functional @ui @tc-001
  Scenario: [TC-001] Successful login with standard user redirects to inventory and stores session token
    Given the user is on the login page
    Then the username and password inputs and the Login button are displayed
    When the user enters username "standard_user" and password "secret_sauce" and clicks the Login button
    Then the user is redirected to "/inventory.html"
    And the session token is stored in Local Storage

  @positive @ac-2 @br-1 @regression @functional @ui @tc-002
  Scenario: [TC-002] Login with performance glitch user redirects successfully within latency threshold
    Given the user is on the login page
    Then the username and password inputs and the Login button are displayed
    When the user enters username "performance_glitch_user" and password "secret_sauce" and clicks the Login button
    Then the user is redirected to "/inventory.html" within 5000 ms

  @positive @ac-3 @br-1 @regression @functional @ui @tc-003
  Scenario: [TC-003] Login with problem user displays the same product image for all products
    Given the user is on the login page
    Then the username and password inputs and the Login button are displayed
    When the user enters username "problem_user" and password "secret_sauce" and clicks the Login button
    Then the user is redirected to "/inventory.html"
    And the same product image is displayed for all products in the catalog

  @positive @ac-4 @br-1 @regression @functional @ui @error-handling @tc-004
  Scenario: [TC-004] Login with error user redirects successfully and displays compromise error dialog
    Given the user is on the login page
    Then the username and password inputs and the Login button are displayed
    When the user enters username "error_user" and password "secret_sauce" and clicks the Login button
    Then the user is redirected to "/inventory.html"
    And an error dialog with the message "credentials are compromise" is displayed
    And the same product image is displayed for all products in the catalog

  @positive @ac-5 @br-1 @regression @functional @ui @tc-005
  Scenario: [TC-005] Login with visual user redirects successfully and displays visual glitch images
    Given the user is on the login page
    Then the username and password inputs and the Login button are displayed
    When the user enters username "visual_user" and password "secret_sauce" and clicks the Login button
    Then the user is redirected to "/inventory.html"
    And the same product image is displayed for all products as a visual glitch

  @edge @ac-6 @regression @functional @ui @tc-006
  Scenario: [TC-006] Login button remains enabled and does not show loading indicator upon click
    Given the user is on the login page
    Then the Login button is displayed in an enabled state
    When the user clicks the Login button
    Then the Login button remains enabled
    And the Login button does not transition to a disabled state
    And the Login button does not show a loading indicator

  @edge @br-2 @regression @functional @ui @tc-007
  Scenario: [TC-007] Username field is case sensitive and rejects uppercase standard user username
    Given the user is on the login page
    Then the username and password inputs are displayed
    When the user enters username "STANDARD_USER" and password "secret_sauce" and clicks the Login button
    Then the user remains on the login page

  @edge @br-3 @regression @functional @ui @tc-008
  Scenario: [TC-008] Password field masks all entered characters
    Given the user is on the login page
    Then the password input is displayed
    When the user enters password "secret_sauce"
    Then the password field masks all characters
