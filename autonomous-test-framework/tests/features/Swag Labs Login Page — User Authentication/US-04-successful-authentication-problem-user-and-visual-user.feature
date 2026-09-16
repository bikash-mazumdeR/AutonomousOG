Feature: Swag Labs Login Page — User Authentication — US-04 Successful Authentication — Problem User and Visual User
  As a problem_user / visual_user
  I want to Authenticate and reach the product catalog page, which may exhibit visual inconsistencies
  So that Support visual regression and visual comparison testing

  @positive @ac-1 @ac-3 @br-1 @br-2 @smoke @regression @functional @ui @tc-027
  Scenario: [TC-027] problem_user logs in with valid credentials and reaches the inventory page
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user enters username "problem_user" and password "secret_sauce" and clicks Login
    Then the user is redirected to "/inventory.html"
    And the product catalog page is displayed

  @positive @ac-2 @ac-4 @br-1 @br-2 @regression @functional @ui @tc-028
  Scenario: [TC-028] visual_user logs in with valid credentials and reaches the inventory page
    Given the user is on the login page
    Then the Username and Password inputs and the Login button are displayed
    When the user enters username "visual_user" and password "secret_sauce" and clicks Login
    Then the user is redirected to "/inventory.html"
    And the product catalog page is displayed
