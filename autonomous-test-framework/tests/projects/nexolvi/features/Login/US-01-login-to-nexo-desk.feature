Feature: Login — US-01 Login to Nexo Desk
  As a authorized user
  I want to log in to Nexo Desk using email and password
  So that access the Nexo Desk Dashboard securely

  @positive @ac-8 @ac-10 @ac-11 @smoke @functional @tc-001
  Scenario: [TC-001] Successful login with valid credentials redirects to the Nexo Desk Dashboard
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user views the login form
    Then the Email field, Password field, Remember Me checkbox labelled 'Remember me for 30 days', and Sign In button are displayed
    When the user enters 'bikash.htc@gmail.com' in the Email field and 'admin' in the Password field and clicks Sign In
    Then the user is redirected to the Nexo Desk Dashboard

  @positive @ac-4 @br-1 @functional @tc-002
  Scenario: [TC-002] Sign In button becomes enabled when both Email and Password fields contain at least one character
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user enters at least one character in the Email field and at least one character in the Password field
    Then the Sign In button is enabled

  @positive @ac-12 @ac-16 @ui @security @tc-003
  Scenario: [TC-003] Password field masks its value by default on the login page
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user enters a value in the Password field
    Then the Password field value is masked

  @positive @ac-13 @ac-14 @ui @tc-004
  Scenario: [TC-004] Clicking the eye icon once reveals the password and clicking it again re-masks it
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user enters a value in the Password field and clicks the eye icon once
    Then the password text is visible in the Password field
    When the user clicks the eye icon again
    Then the Password field value is masked

  @positive @ac-9 @br-3 @functional @tc-005
  Scenario: [TC-005] Selecting Remember Me during successful login persists the session for 30 days
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user checks the Remember Me checkbox labelled 'Remember me for 30 days', enters 'bikash.htc@gmail.com' in the Email field and 'admin' in the Password field, and clicks Sign In
    Then the user is redirected to the Nexo Desk Dashboard and the login session is persisted for 30 days

  @negative @ac-5 @ac-15 @br-2 @functional @error-handling @tc-006
  Scenario: [TC-006] Submitting an invalid email with a valid password displays the Login failed error in the DOM
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user enters '{{invalidEmail}}' in the Email field and 'admin' in the Password field and clicks Sign In
    Then the error message 'Login failed' is displayed in the page DOM and no browser alert is shown

  @negative @ac-6 @ac-15 @br-2 @functional @error-handling @tc-007
  Scenario: [TC-007] Submitting a valid email with an invalid password displays the Login failed error in the DOM
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user enters 'bikash.htc@gmail.com' in the Email field and '{{invalidPassword}}' in the Password field and clicks Sign In
    Then the error message 'Login failed' is displayed in the page DOM and no browser alert is shown

  @negative @ac-7 @ac-15 @br-2 @functional @error-handling @tc-008
  Scenario: [TC-008] Submitting an invalid email and an invalid password displays the Login failed error in the DOM
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user enters '{{invalidEmail}}' in the Email field and '{{invalidPassword}}' in the Password field and clicks Sign In
    Then the error message 'Login failed' is displayed in the page DOM and no browser alert is shown

  @negative @ac-1 @br-1 @functional @tc-009
  Scenario: [TC-009] Sign In button is disabled when both Email and Password fields are empty
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user views the login form with both the Email and Password fields empty
    Then the Sign In button is disabled

  @negative @ac-2 @br-1 @functional @tc-010
  Scenario: [TC-010] Sign In button is disabled when only the Email field has a value
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user enters a value in the Email field and leaves the Password field empty
    Then the Sign In button is disabled

  @negative @ac-3 @br-1 @functional @tc-011
  Scenario: [TC-011] Sign In button is disabled when only the Password field has a value
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user enters a value in the Password field and leaves the Email field empty
    Then the Sign In button is disabled

  @edge @ac-4 @br-1 @functional @tc-012
  Scenario: [TC-012] Sign In button becomes enabled when each field contains exactly one character
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user enters exactly one character in the Email field and exactly one character in the Password field
    Then the Sign In button is enabled

  @edge @ac-1 @ac-2 @ac-3 @br-1 @functional @tc-013
  Scenario: [TC-013] Sign In button returns to disabled state after clearing one field that was previously populated
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user enters a value in the Email field and a value in the Password field
    Then the Sign In button is enabled
    When the user clears the Password field
    Then the Sign In button is disabled

  @edge @ac-14 @ui @tc-014
  Scenario: [TC-014] Password visibility toggles correctly across multiple consecutive eye icon clicks
    Given the user navigates to https://admin.nexolvi.ai
    Then the login page is displayed
    When the user enters a value in the Password field and clicks the eye icon once
    Then the password text is visible in the Password field
    When the user clicks the eye icon a second time
    Then the Password field value is masked
    When the user clicks the eye icon a third time
    Then the password text is visible in the Password field
