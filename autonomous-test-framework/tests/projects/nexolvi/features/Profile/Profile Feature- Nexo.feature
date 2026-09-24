Feature: Profile Feature — US-01 View and Edit Profile Information
  As a authenticated user
  I want to view and update my account information including name, email, phone number, and password
  So that keep my account details current and secure

  @positive @ac-1 @ac-2 @ac-3 @smoke @functional @tc-001
  Scenario: [TC-001] Login page displays required fields and Sign In button is disabled until both fields are filled
    Given the user navigates to "https://admin.nexolvi.ai/login"
    Then the Email field, Password field, 'Remember me for 30 days' checkbox, and Sign In button are displayed
    When the user views the Sign In button with both Email and Password fields empty
    Then the Sign In button is disabled
    When the user enters a value in the Email field and leaves the Password field empty
    And with test data "Email: "qa.user@example.test""
    Then the Sign In button is disabled
    When the user enters a value in both the Email field and the Password field
    And with test data "Email: "qa.user@example.test", Password: "Aria_Pass_01!""
    Then the Sign In button is enabled

  @positive @ac-4 @ac-5 @smoke @functional @tc-002
  Scenario: [TC-002] Valid credentials redirect to Dashboard and profile button displays character B
    Given the user is on the login page at "https://admin.nexolvi.ai/login"
    Then the Email field, Password field, and Sign In button are displayed
    When the user enters {{validEmail}} in the Email field and {{validPassword}} in the Password field and clicks Sign In
    Then the page displays the header "Dashboard"
    When the user views the top-left corner of the Dashboard
    Then a profile button displaying the character 'B' is visible

  @positive @ac-6 @ac-7 @ac-8 @ac-9 @ac-10 @ac-11 @ac-12 @functional @tc-003
  Scenario: [TC-003] Opening My Profile modal shows pre-populated editable fields and Change Password section
    Given the user is authenticated and on the Dashboard at "https://admin.nexolvi.ai/"
    Then the Dashboard header is displayed
    When the user clicks the profile button at the top-left corner
    Then the user menu is displayed containing the user initial, the email 'bikash.htc@gmail.com', a 'Profile' option, and a 'Logout' option
    When the user clicks the 'Profile' option in the user menu
    Then the My Profile modal opens displaying the title 'My Profile' and the description 'View and edit your account information.'
    When the user views the fields in the My Profile modal
    Then the Name, Email, and Phone fields are displayed pre-populated with the user's current account information and are editable
    And the 'Change Password' section is displayed with a 'New Password' input field and a 'Confirm Password' input field
    And a Close (X) button is visible in the top-right corner of the modal

  @positive @ac-13 @ac-16 @ac-17 @br-2 @functional @isolated-session @tc-004
  Scenario: [TC-004] Saving profile with blank password fields preserves existing password and reflects updated info
    Given the user has the My Profile modal open
    Then the Name, Email, Phone, New Password, and Confirm Password fields are displayed
    When the user updates the Name field with {{updatedName}} and leaves New Password and Confirm Password blank and clicks 'Save Changes'
    Then a toast with the text "Profile updated successfully" is displayed
    When the user reopens the My Profile modal
    Then the Name field displays {{updatedName}} reflecting the updated profile information
    And the user replaces the Name field with "bikash.htc" and clicks 'Save Changes'
    And the My Profile modal closes and a toast with the text "Profile updated successfully" is displayed

  @positive @ac-15 @ac-16 @br-3 @functional @isolated-session @tc-005
  Scenario: [TC-005] Saving profile with matching non-empty passwords accepts the new password
    Given the user has the My Profile modal open
    Then the New Password and Confirm Password fields are displayed
    When the user enters {{newPassword}} in the New Password field and {{newPassword}} in the Confirm Password field and clicks 'Save Changes'
    Then A toast message with "Profile updated successfully" will appear.

  @negative @ac-14 @ac-26 @br-3 @br-4 @error-handling @tc-006
  Scenario: [TC-006] Mismatched New Password and Confirm Password values reject the save with a mismatch error
    Given the user has the My Profile modal open
    Then the New Password and Confirm Password fields are displayed
    When the user enters {{newPassword}} in the New Password field and {{differentPassword}} in the Confirm Password field and clicks 'Save Changes'
    Then the save is rejected, the My Profile modal stays open and a toast with the title "Error" and the text "Passwords do not match" is displayed

  @negative @ac-2 @br-1 @functional @tc-007
  Scenario: [TC-007] Sign In button remains disabled when only the Email field contains a value
    Given the user is on the login page at "https://admin.nexolvi.ai/login"
    Then the Email field and Password field are displayed and both are empty
    When the user enters "qa.user@example.test" in the Email field and leaves the Password field empty
    Then the Sign In button is disabled

  @negative @ac-2 @br-1 @functional @tc-008
  Scenario: [TC-008] Sign In button remains disabled when only the Password field contains a value
    Given the user is on the login page at "https://admin.nexolvi.ai/login"
    Then the Email field and Password field are displayed and both are empty
    When the user leaves the Email field empty and enters "Aria_Pass_01!" in the Password field
    Then the Sign In button is disabled

  @negative @ac-18 @br-5 @functional @tc-009
  Scenario: [TC-009] Clicking Cancel discards unsaved changes and closes the modal leaving the user on the Dashboard
    Given the user has the My Profile modal open and has replaced the Name field with "Unsaved Name" without saving
    Then the Name field shows "Unsaved Name"
    When the user clicks 'Cancel'
    Then the My Profile modal is closed and the header "Dashboard" is displayed
    And the user reopens the My Profile modal
    And the Name field shows "bikash.htc"

  @edge @ac-3 @br-1 @functional @tc-010
  Scenario: [TC-010] Sign In button becomes enabled when each field contains exactly one character
    Given the user is on the login page at "https://admin.nexolvi.ai/login"
    Then the Sign In button is disabled with both fields empty
    When the user enters a single character in the Email field and a single character in the Password field
    And with test data "Email: "a", Password: "b""
    Then the Sign In button is enabled

  @edge @ac-9 @functional @tc-011
  Scenario: [TC-011] Clicking the Close X button on the My Profile modal closes the modal
    Given the user has the My Profile modal open
    Then the Close (X) button is visible in the top-right corner of the modal
    When the user clicks the Close (X) button
    Then the My Profile modal is closed and the Dashboard is displayed

  @edge @ac-19 @ac-20 @ac-21 @ac-22 @ac-23 @ac-24 @ac-25 @ui @tc-012
  Scenario: [TC-012] My Profile modal and user menu display exact UI text and profile button shows correct tooltip
    Given the user is authenticated and on the Dashboard at "https://admin.nexolvi.ai/"
    Then the profile button at the top-left displays the character 'B'
    When the user hovers over the profile button
    Then the profile button has the title attribute "bikash.htc"
    When the user clicks the profile button
    Then the user menu displays the name "bikash.htc", the signed-in account's email, a "Profile" option and a "Logout" option
    When the user clicks the 'Profile' option and views the My Profile modal
    Then the modal header text is exactly 'My Profile' and the description text is exactly 'View and edit your account information.'
    And the New Password field displays the placeholder text 'Leave blank to keep current'
    And the Confirm Password field displays the placeholder text 'Repeat new password'

  @edge @ac-27 @security @tc-013
  Scenario: [TC-013] New Password and Confirm Password fields mask entered characters
    Given the user has the My Profile modal open
    Then the 'Change Password' section with New Password and Confirm Password fields is displayed
    When the user enters {{newPassword}} in the New Password field and {{newPassword}} in the Confirm Password field
    Then the New Password field has type="password"
    And the Confirm Password field has type="password"

  @positive @ac-14 @ac-16 @functional @regression @isolated-session @tc-014
  Scenario: [TC-014] Saving the profile a second time in the same session succeeds
    Given the user has the My Profile modal open
    Then the Name, Email, Phone, New Password, and Confirm Password fields are displayed
    When the user clicks 'Save Changes' without changing any field
    Then the My Profile modal closes and a toast with the text "Profile updated successfully" is displayed
    When the user reopens the My Profile modal
    Then the Name, Email, and Phone fields are displayed
    And the user clicks 'Save Changes' again without changing any field
    And the My Profile modal closes
