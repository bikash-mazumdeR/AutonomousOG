Feature: Swag Labs Login Page — User Authentication — US-01 Login Page Renders Correctly
  As a User
  I want to See a fully rendered login page with all required components upon navigating to the application root
  So that I can identify and interact with all authentication elements before attempting to log in

  @positive @ac-1 @smoke @regression @functional @ui @tc-001
  Scenario: [TC-001] Browser tab and page heading display Swag Labs title on navigation
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the user observes the browser tab title and page heading
    Then the browser tab title reads "Swag Labs"
    And the page heading reads "Swag Labs"

  @positive @ac-2 @regression @functional @ui @tc-002
  Scenario: [TC-002] Login form is centred on a 375 px mobile viewport
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the viewport width is set to 375 px
    Then the login form is horizontally and vertically centred on the page

  @positive @ac-2 @regression @functional @ui @tc-003
  Scenario: [TC-003] Login form is centred on a 1920 px desktop viewport
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the viewport width is set to 1920 px
    Then the login form is horizontally and vertically centred on the page

  @positive @ac-3 @regression @functional @ui @tc-004
  Scenario: [TC-004] Username text-input field is visible and correctly labelled on the login page
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the user observes the login form
    Then a text-input field labelled "Username" is visible on the page

  @positive @ac-4 @regression @functional @ui @tc-005
  Scenario: [TC-005] Password field is visible, labelled Password, and masks typed characters
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the user types a value into the Password field
    And with test data "{{validPassword}}"
    Then the Password input field is visible and labelled "Password"
    And the typed characters are masked as dots or asterisks

  @positive @ac-5 @br-2 @smoke @regression @functional @ui @tc-006
  Scenario: [TC-006] Login button is visible and enabled when both fields are empty
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the user observes the login form without entering any credentials
    Then a submit button labelled "Login" is visible on the page
    And the Login button is in an enabled state

  @positive @ac-5 @br-2 @regression @functional @ui @tc-007
  Scenario: [TC-007] Login button remains enabled after entering text in the Username field only
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the user enters a value into the Username field and leaves the Password field empty
    And with test data "{{validUsername}}"
    Then the Login button is in an enabled state

  @positive @ac-5 @br-2 @regression @functional @ui @tc-008
  Scenario: [TC-008] Login button remains enabled after entering text in the Password field only
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the user enters a value into the Password field and leaves the Username field empty
    And with test data "{{validPassword}}"
    Then the Login button is in an enabled state

  @positive @ac-6 @regression @functional @ui @tc-009
  Scenario: [TC-009] Swag Labs logo image is visible on the login page
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the user observes the login page
    Then the Swag Labs logo image is visible on the page

  @positive @ac-7 @br-1 @regression @functional @ui @tc-010
  Scenario: [TC-010] Credentials Info Box is visible and displays test usernames and password hint
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the user observes the Credentials Info Box
    Then the Credentials Info Box is visible on the page
    And the Credentials Info Box displays the available test usernames and the password hint

  @positive @ac-8 @regression @functional @ui @tc-011
  Scenario: [TC-011] All login form elements are visible at the minimum supported viewport width of 320 px
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the viewport width is set to 320 px
    Then the Username input field is visible on the page
    And the Password input field is visible on the page
    And the Login button is visible on the page
    And the Swag Labs logo image is visible on the page

  @positive @ac-8 @regression @functional @ui @tc-012
  Scenario: [TC-012] All login form elements are visible at the maximum supported viewport width of 2560 px
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the viewport width is set to 2560 px
    Then the Username input field is visible on the page
    And the Password input field is visible on the page
    And the Login button is visible on the page
    And the Swag Labs logo image is visible on the page

  @positive @ac-9 @regression @accessibility @tc-013
  Scenario: [TC-013] Username and Password form fields have programmatically associated labels for screen readers
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the user inspects the accessibility attributes of the login form fields
    Then the Username input field has a programmatically associated label accessible to screen readers
    And the Password input field has a programmatically associated label accessible to screen readers

  @positive @ac-10 @regression @accessibility @tc-014
  Scenario: [TC-014] Error message rendered below the form is announced to screen readers when it appears
    Given the user navigates to "https://www.saucedemo.com"
    Then the login page is displayed
    When the user clicks the Login button without entering any credentials
    Then an error message is rendered below the login form
    And the error message container has an appropriate ARIA role or live region attribute so that it is announced by screen readers
