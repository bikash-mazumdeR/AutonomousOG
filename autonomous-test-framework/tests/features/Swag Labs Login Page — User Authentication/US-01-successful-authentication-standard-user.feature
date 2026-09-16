Feature: Swag Labs Login Page — User Authentication — US-01 Successful Authentication — Standard User
  As a standard_user
  I want to Authenticate using valid username and password credentials
  So that Access the inventory catalog

  @positive @ac-1 @br-1 @smoke @regression @functional @tc-001
  Scenario: [TC-001] Standard user with valid credentials is redirected to the inventory page
    Given the user is on the login page at saucedemo.com
    Then the Username input, Password input, and Login button are displayed
    When the user enters 'standard_user' in the Username field and 'secret_sauce' in the Password field and clicks the Login button
    Then the user is redirected to '/inventory.html'

  @positive @ac-3 @regression @functional @tc-002 @held
  Scenario: [TC-002] Login button is enabled and clickable when both fields are empty
    Given the user is on the login page at saucedemo.com
    Then the Login button is displayed
    When the user observes the Login button with no input entered in any field
    Then the Login button is enabled and clickable

  @positive @ac-4 @br-2 @regression @functional @tc-004 @held
  Scenario: [TC-004] Username field accepts alphanumeric characters and underscores on successful login
    Given the user is on the login page at saucedemo.com
    Then the Username text input field is displayed
    When the user enters 'standard_user' in the Username field and 'secret_sauce' in the Password field and clicks the Login button
    Then the user is redirected to '/inventory.html'

  @positive @ac-6 @regression @functional @tc-006
  Scenario: [TC-006] Password field accepts pasted input and authenticates successfully
    Given the user is on the login page at saucedemo.com
    Then the Password input field is displayed
    When the user enters 'standard_user' in the Username field and pastes 'secret_sauce' into the Password field and clicks the Login button
    Then the user is redirected to '/inventory.html'

  @positive @ac-7 @regression @ui @tc-007
  Scenario: [TC-007] Password field masks all entered characters
    Given the user is on the login page at saucedemo.com
    Then the Password input field is displayed
    When the user enters 'secret_sauce' in the Password field
    Then all entered characters in the Password field are masked as dots or asterisks

  @positive @ac-8 @regression @ui @tc-008
  Scenario: [TC-008] Login page title is Swag Labs
    Given the user is on the login page at saucedemo.com
    Then the Swag Labs logo is displayed
    When the user reads the browser page title
    Then the browser page title is 'Swag Labs'

  @positive @ac-9 @regression @ui @tc-009
  Scenario: [TC-009] Login form is centered on the page
    Given the user is on the login page at saucedemo.com
    Then the Swag Labs logo is displayed
    When the user observes the layout of the login form
    Then the login form is horizontally centered on the page

  @positive @ac-10 @regression @ui @tc-010
  Scenario: [TC-010] Login page is functional and usable at 375px mobile viewport width
    Given the user is on the login page at saucedemo.com
    Then the login page is loaded
    When the viewport width is set to 375px
    Then the Username input, Password input, and Login button are all visible and usable without horizontal scrolling

  @positive @ac-10 @regression @ui @tc-011
  Scenario: [TC-011] Login page is functional and usable at 1920px desktop viewport width
    Given the user is on the login page at saucedemo.com
    Then the login page is loaded
    When the viewport width is set to 1920px
    Then the Username input, Password input, and Login button are all visible and usable without horizontal scrolling

  @positive @ac-12 @regression @accessibility @tc-013 @held
  Scenario: [TC-013] Error messages are announced to screen readers when displayed
    Given the user is on the login page at saucedemo.com
    Then the Username text input field and Login button are displayed
    When the user clicks the Login button without entering any credentials
    Then an error message is displayed
    And the error message container has an appropriate ARIA role or live region attribute so it is announced to screen readers

  @positive @ac-2 @regression @functional @ui @tc-003 @obsolete
  Scenario: [TC-003] Login page displays all required components on load
    Given the user is on the login page at saucedemo.com
    Then the Swag Labs logo is displayed
    When the user observes the login form components
    Then the Username text input field, Password password input field, Login submit button, and Credentials Info Box are all displayed

  @positive @ac-5 @regression @functional @tc-005 @obsolete
  Scenario: [TC-005] Username field trims leading and trailing whitespace before credential validation
    Given the user is on the login page at saucedemo.com
    Then the Username text input field is displayed
    When the user enters ' standard_user ' in the Username field and 'secret_sauce' in the Password field and clicks the Login button
    Then the user is redirected to '/inventory.html'

  @positive @ac-11 @regression @security @tc-012 @obsolete
  Scenario: [TC-012] Login form enforces parameterized queries preventing SQL injection via Username field
    Given the user is on the login page at saucedemo.com
    Then the Username text input field and Password input field are displayed
    When the user enters "{{sqlInjectionPayload}}" in the Username field and 'secret_sauce' in the Password field and clicks the Login button
    Then the user is not authenticated and is not redirected to '/inventory.html'

  @positive @ac-13 @regression @functional @tc-014 @obsolete
  Scenario: [TC-014] Login page is functional on Chrome latest-1
    Given the user is on the login page at saucedemo.com running on Chrome latest-1
    Then the login page is loaded
    When the user enters 'standard_user' in the Username field and 'secret_sauce' in the Password field and clicks the Login button
    Then the user is redirected to '/inventory.html'

  @positive @ac-13 @regression @functional @tc-015 @obsolete
  Scenario: [TC-015] Login page is functional on Firefox latest-1
    Given the user is on the login page at saucedemo.com running on Firefox latest-1
    Then the login page is loaded
    When the user enters 'standard_user' in the Username field and 'secret_sauce' in the Password field and clicks the Login button
    Then the user is redirected to '/inventory.html'

  @positive @ac-13 @regression @functional @tc-016 @obsolete
  Scenario: [TC-016] Login page is functional on Safari latest-1
    Given the user is on the login page at saucedemo.com running on Safari latest-1
    Then the login page is loaded
    When the user enters 'standard_user' in the Username field and 'secret_sauce' in the Password field and clicks the Login button
    Then the user is redirected to '/inventory.html'

  @positive @ac-13 @regression @functional @tc-017 @obsolete
  Scenario: [TC-017] Login page is functional on Edge latest-1
    Given the user is on the login page at saucedemo.com running on Edge latest-1
    Then the login page is loaded
    When the user enters 'standard_user' in the Username field and 'secret_sauce' in the Password field and clicks the Login button
    Then the user is redirected to '/inventory.html'
