Feature: Swag Labs Login Page — User Authentication — US-05 Successful Authentication — Performance Glitch User
  As a performance_glitch_user
  I want to Authenticate and reach the product catalog page, which loads with intentional latency
  So that Support performance testing and optimization

  @positive @ac-1 @ac-2 @br-1 @br-2 @smoke @regression @functional @ui @tc-029 @obsolete
  Scenario: [TC-029] performance_glitch_user authenticates successfully and is redirected to the inventory page
    Given the user is on the login page
    Then the Username input, Password input, and Login button are displayed
    When the user enters username "performance_glitch_user" and password "secret_sauce" and clicks Login
    Then the user is redirected to "/inventory.html"
    And the product catalog page is displayed with a noticeable latency compared to a standard_user login
