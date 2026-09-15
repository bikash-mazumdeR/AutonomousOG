Feature: Swag Labs Login Page — User Authentication — US-02 Successful Login — Standard User
  As a standard_user
  I want to Authenticate with valid credentials and be redirected to the inventory page
  So that I can access the product catalog

  @positive @ac-1 @ac-2 @ac-4 @br-2 @smoke @regression @functional @security @tc-015
  Scenario: [TC-015] Standard user login with valid credentials redirects to inventory page
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed with the Username input, Password input, and Login button
    When the user enters username "standard_user" and password "secret_sauce" and clicks Login
    Then the browser is redirected to "/inventory.html"
    And the user remains on "/inventory.html" and is not redirected back to the login page
    And the browser URL path is "/inventory.html" and no credentials are exposed in the URL

  @positive @ac-3 @regression @ui @tc-016
  Scenario: [TC-016] Login button remains enabled throughout the login interaction for standard user
    Given the user navigates to "https://www.saucedemo.com"
    Then the Login button is displayed and enabled
    When the user enters username "standard_user" and password "secret_sauce" and clicks Login
    Then the Login button is enabled and not disabled and not showing a loading spinner during and after the login interaction

  @negative @br-1 @regression @functional @tc-017
  Scenario: [TC-017] Login with username in wrong case is rejected and user stays on login page
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed with the Username input, Password input, and Login button
    When the user enters username "Standard_User" and password "secret_sauce" and clicks Login
    Then the user remains on the login page and is not redirected to "/inventory.html"
