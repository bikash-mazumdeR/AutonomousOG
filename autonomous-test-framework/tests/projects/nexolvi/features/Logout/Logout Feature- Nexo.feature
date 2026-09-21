Feature: Logout Feature – Nexo Desk — US-01 Logout from Nexo Desk Dashboard
  As a authenticated user
  I want to securely log out of the Nexo Desk application
  So that ensure my session is terminated and no unauthorised access to my account is possible

  @positive @ac-1 @ac-8 @smoke @functional @ui @tc-log-001
  Scenario: [TC-LOGOUT-001] Profile button displays the user initial at the top-left corner of the Dashboard after login
    Given the authenticated user is on the Dashboard at https://admin.nexolvi.ai/
    Then the Dashboard page is displayed
    When the user views the top-left corner of the Dashboard
    Then the profile button displaying the single uppercase character 'B' is visible at the top-left corner

  @positive @ac-2 @ac-10 @functional @ui @tc-log-002
  Scenario: [TC-LOGOUT-002] Clicking the profile button opens the user menu with all required elements
    Given the authenticated user is on the Dashboard at https://admin.nexolvi.ai/
    Then the Dashboard page is displayed
    When the user clicks the profile button at the top-left corner
    Then the user menu is displayed containing the user initial, the email address bikash.htc@gmail.com, a Profile button, and a Logout button as distinct visible elements

  @positive @ac-3 @ac-4 @ac-11 @ac-12 @ac-13 @br-2 @smoke @functional @ui @tc-log-003
  Scenario: [TC-LOGOUT-003] Clicking Logout in the user menu displays the native browser confirmation popup with correct text
    Given the authenticated user is on the Dashboard at https://admin.nexolvi.ai/
    Then the Dashboard page is displayed
    When the user clicks the profile button and then clicks the Logout button in the user menu
    Then a native browser dialog is displayed with header text 'Log out?' and body text 'Are you sure you want to log out? Any unsaved changes will be lost.'
    And The text for Cancel button is "Cancel" and for Logout button is "Logout"

  @positive @ac-6 @ac-14 @br-3 @smoke @functional @security @tc-log-004
  Scenario: [TC-LOGOUT-004] Clicking Logout in the confirmation popup terminates the session and redirects to the Login page
    Given the authenticated user has clicked Logout in the user menu and the confirmation popup is displayed
    Then Logout text as header. with the text "Logout is the header text"
    And Are you sure you want to log out? Any unsaved changes will be lost. -- as the body
    And Cancel button text is "Cancel"
    And And Logout button text is "Logout"
    When the user clicks the Logout button in the confirmation popup
    Then the session is terminated and the user is redirected to the Login page at https://admin.nexolvi.ai/
    And the Dashboard is no longer accessible

  @positive @ac-5 @ac-15 @br-3 @functional @error-handling @tc-log-005
  Scenario: [TC-LOGOUT-005] Clicking Cancel on the confirmation popup closes it and keeps the user authenticated on the Dashboard
    Given the authenticated user has clicked Logout in the user menu and the confirmation popup is displayed
    Then the native browser confirmation dialog is displayed with the text "Are you sure you want to log out? Any unsaved changes will be lost."
    When the user clicks the Cancel button in the confirmation popup
    Then the confirmation popup is closed and the user remains on the Dashboard at https://admin.nexolvi.ai/
    And the user remains authenticated with no session change

  @negative @ac-7 @br-3 @functional @security @tc-log-006
  Scenario: [TC-LOGOUT-006] Navigating to the Dashboard URL after logout displays the Login page instead of the Dashboard
    Given the user has completed the logout flow and is on the Login page at https://admin.nexolvi.ai/
    Then the Login page is displayed
    When the user navigates to https://admin.nexolvi.ai/
    Then the Login page is displayed and the Dashboard is not accessible

  @negative @ac-14 @br-3 @functional @security @tc-log-007
  Scenario: [TC-LOGOUT-007] Attempting to reuse a terminated session to access the Dashboard is blocked
    Given the user has completed the logout flow and the session has been terminated
    Then the Login page at https://admin.nexolvi.ai/ is displayed
    When the user attempts to access the Dashboard by navigating to https://admin.nexolvi.ai/
    Then the Login page is displayed instead of the Dashboard, confirming the terminated session cannot be reused

  @edge @ac-9 @ui @tc-log-008
  Scenario: [TC-LOGOUT-008] Hovering over the profile button displays the user email as a native browser tooltip
    Given the authenticated user is on the Dashboard at https://admin.nexolvi.ai/
    Then the Dashboard page is displayed
    When the user hovers over the profile button at the top-left corner
    Then First part of the email - " bikash.htc" will be displayed.

  @edge @ac-1 @ac-8 @ui @tc-log-009
  Scenario: [TC-LOGOUT-009] Profile button displays exactly the single uppercase character 'B' derived from bikash.htc@gmail.com
    Given the authenticated user is on the Dashboard at https://admin.nexolvi.ai/
    Then the Dashboard page is displayed
    When the user views the profile button at the top-left corner
    Then the profile button displays exactly the single uppercase character 'B' and no other characters

  @edge @ac-5 @ac-15 @br-3 @functional @error-handling @tc-log-010
  Scenario: [TC-LOGOUT-010] Reopening the user menu after cancelling the logout popup shows the menu again without session change
    Given the authenticated user has clicked Cancel on the logout confirmation popup and is back on the Dashboard
    Then the Dashboard is displayed and the user is authenticated
    When the user clicks the profile button again
    Then the user menu is displayed again containing the user initial, the email address bikash.htc@gmail.com, a Profile button, and a Logout button
