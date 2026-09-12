Feature: Swag Labs Login Authentication & Form Handling
  As a user of the application,
  I want to Validate user input fields, enforce display standards, ensure screen reader accessibility, and maintain constant button state across viewports.
  So that access protected functionality.

  Background:
    Given the user is on the login page

  @positive @functional @ui @smoke @regression @tc-008
  Scenario: [TC-008] Verify the Username field accepts case-sensitive alphanum
    Given Navigate to the feature: Login Form Validation, UI & Accessibility (@ui @accessibility @error-handling)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Verify the Username field accepts case-sensitive alphanumeric characters, unders
    And with test data "{{validName}}"
    Then System confirms: Verify the Username field accepts case-sensitive alphanumeric characters, underscores, hyphens up to 255 characters, and trims leading/trailing whitespace.
    Then System confirms: Verify the Username field accepts case-sensitive alphanumeric characters, underscores, hyphens up to 255 characters, and trims leading/trailing whitespace.

  @positive @functional @ui @smoke @regression @tc-009
  Scenario: [TC-009] Verify the Password field masks characters as dotsasteri
    Given Navigate to the feature: Login Form Validation, UI & Accessibility (@ui @accessibility @error-handling)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Verify the Password field masks characters as dots/asterisks up to 512 character
    And with test data "{{validPassword}}"
    Then System confirms: Verify the Password field masks characters as dots/asterisks up to 512 characters and permits browser copy/paste actions.
    Then System confirms: Verify the Password field masks characters as dots/asterisks up to 512 characters and permits browser copy/paste actions.

  @positive @functional @ui @smoke @regression @tc-010
  Scenario: [TC-010] Verify submitting the form when both Username and Passwor
    Given Navigate to the feature: Login Form Validation, UI & Accessibility (@ui @accessibility @error-handling)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Verify submitting the form when both Username and Password fields are empty disp
    And with test data "{{validPassword}}"
    Then System confirms: Verify submitting the form when both Username and Password fields are empty displays error message 'Epic sadface: Username is required'.
    Then System confirms: Verify submitting the form when both Username and Password fields are empty displays error message 'Epic sadface: Username is required'.
    Then Changes are retained after page reload

  @positive @functional @ui @smoke @regression @tc-011
  Scenario: [TC-011] Verify submitting the form when only Password field is em
    Given Navigate to the feature: Login Form Validation, UI & Accessibility (@ui @accessibility @error-handling)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Verify submitting the form when only Password field is empty displays error mess
    And with test data "{{validPassword}}"
    Then System confirms: Verify submitting the form when only Password field is empty displays error message 'Epic sadface: Password is required'.
    Then System confirms: Verify submitting the form when only Password field is empty displays error message 'Epic sadface: Password is required'.
    Then Changes are retained after page reload

  @positive @functional @ui @smoke @regression @tc-012
  Scenario: [TC-012] Verify the Login button remains in an enabled state at al
    Given Navigate to the feature: Login Form Validation, UI & Accessibility (@ui @accessibility @error-handling)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Verify the Login button remains in an enabled state at all times regardless of f
    And with test data "{{validTestData}}"
    Then System confirms: Verify the Login button remains in an enabled state at all times regardless of field population or user clicks.
    Then System confirms: Verify the Login button remains in an enabled state at all times regardless of field population or user clicks.

  @positive @functional @ui @smoke @regression @tc-013
  Scenario: [TC-013] Verify error messages render in red text (E2453C) persi
    Given Navigate to the feature: Login Form Validation, UI & Accessibility (@ui @accessibility @error-handling)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Verify error messages render in red text (#E2453C), persist until form resubmiss
    And with test data "{{validTestData}}"
    Then System confirms: Verify error messages render in red text (#E2453C), persist until form resubmission or page refresh, and are properly announced to screen readers.
    Then System confirms: Verify error messages render in red text (#E2453C), persist until form resubmission or page refresh, and are properly announced to screen readers.

  @positive @functional @ui @smoke @regression @tc-014
  Scenario: [TC-014] Verify the login form layout centers properly across resp
    Given Navigate to the feature: Login Form Validation, UI & Accessibility (@ui @accessibility @error-handling)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: Verify the login form layout centers properly across responsive viewports rangin
    And with test data "{{validTestData}}"
    Then System confirms: Verify the login form layout centers properly across responsive viewports ranging from 320px to 2560px width.
    Then System confirms: Verify the login form layout centers properly across responsive viewports ranging from 320px to 2560px width.
