Feature: Swag Labs Login Page — User Authentication — US-06 Login — Problem User and Visual User Product Image Consistency
  As a problem_user / visual_user
  I want to Verify that after login, all product images on the inventory page display the same (incorrect) repeated image for problem_user and visual_user
  So that Visual regression and consistency defects are detectable via automated assertions

  @positive @ac-1 @smoke @regression @functional @tc-032
  Scenario: [TC-032] problem_user login with valid credentials redirects to inventory page
    Given the user is on the login page
    Then the login form with username input, password input, and Login button is displayed
    When the user enters username "problem_user" and password "secret_sauce" and clicks Login
    Then the browser redirects to "/inventory.html"

  @positive @ac-2 @smoke @regression @functional @tc-033
  Scenario: [TC-033] visual_user login with valid credentials redirects to inventory page
    Given the user is on the login page
    Then the login form with username input, password input, and Login button is displayed
    When the user enters username "visual_user" and password "secret_sauce" and clicks Login
    Then the browser redirects to "/inventory.html"

  @positive @ac-3 @br-1 @br-2 @regression @ui @tc-034
  Scenario: [TC-034] All product images share the same src URL after problem_user login
    Given the user is on the login page
    Then the login form with username input, password input, and Login button is displayed
    When the user enters username "problem_user" and password "secret_sauce" and clicks Login
    Then the browser redirects to "/inventory.html"
    When the user inspects all product image elements on the inventory page
    Then every product image src attribute resolves to the same URL
    And that repeated src URL is extracted and recorded by Playwright MCP at runtime

  @positive @ac-4 @br-1 @br-2 @regression @ui @tc-035
  Scenario: [TC-035] All product images share the same src URL after visual_user login
    Given the user is on the login page
    Then the login form with username input, password input, and Login button is displayed
    When the user enters username "visual_user" and password "secret_sauce" and clicks Login
    Then the browser redirects to "/inventory.html"
    When the user inspects all product image elements on the inventory page
    Then every product image src attribute resolves to the same URL
    And that repeated src URL is extracted and recorded by Playwright MCP at runtime

  @positive @ac-5 @br-1 @regression @ui @tc-036
  Scenario: [TC-036] Repeated product image src for problem_user differs from standard_user product image srcs
    Given the user is on the login page
    Then the login form with username input, password input, and Login button is displayed
    When the user enters username "problem_user" and password "secret_sauce" and clicks Login
    Then the browser redirects to "/inventory.html"
    When the user collects all product image src values on the inventory page
    Then all collected src values are identical to each other
    And at least one collected src value differs from the product image src values observed for "standard_user" on "/inventory.html"

  @positive @ac-5 @br-1 @regression @ui @tc-037
  Scenario: [TC-037] Repeated product image src for visual_user differs from standard_user product image srcs
    Given the user is on the login page
    Then the login form with username input, password input, and Login button is displayed
    When the user enters username "visual_user" and password "secret_sauce" and clicks Login
    Then the browser redirects to "/inventory.html"
    When the user collects all product image src values on the inventory page
    Then all collected src values are identical to each other
    And at least one collected src value differs from the product image src values observed for "standard_user" on "/inventory.html"
