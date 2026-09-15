Feature: Swag Labs Login Page — User Authentication — US-07 Login — Performance Glitch User Login Latency
  As a performance_glitch_user
  I want to Verify that login for performance_glitch_user completes successfully within the defined timeout threshold
  So that Performance regressions for the slow-load user scenario are detected automatically

  @positive @ac-1 @ac-2 @smoke @regression @functional @tc-038
  Scenario: [TC-038] Performance glitch user login redirects to inventory page within 5000 ms
    Given the user is on the login page
    Then the login form with Username input, Password input, and Login button is displayed
    When the user enters username "performance_glitch_user" and password "secret_sauce" and clicks Login
    And with test data "username: performance_glitch_user, password: secret_sauce"
    Then the browser redirects to "/inventory.html" within 5000 ms

  @negative @ac-3 @regression @functional @tc-039
  Scenario: [TC-039] Performance glitch user login flagged as timeout failure when redirect exceeds 5000 ms
    Given the user is on the login page
    Then the login form with Username input, Password input, and Login button is displayed
    When the user enters username "performance_glitch_user" and password "secret_sauce" and clicks Login
    And with test data "username: performance_glitch_user, password: secret_sauce"
    Then if the redirect to "/inventory.html" does not occur within 5000 ms the test is flagged as a timeout failure

  @positive @ac-1 @ac-4 @regression @ui @tc-040
  Scenario: [TC-040] Login button remains enabled during the slow-load period for performance glitch user
    Given the user is on the login page
    Then the login form with Username input, Password input, and Login button is displayed
    When the user enters username "performance_glitch_user" and password "secret_sauce" and clicks Login
    And with test data "username: performance_glitch_user, password: secret_sauce"
    Then the Login button remains enabled throughout the slow-load period
    And the browser eventually redirects to "/inventory.html"
