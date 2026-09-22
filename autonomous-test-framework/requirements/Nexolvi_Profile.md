# Profile Feature – Requirement Document

## 1. Feature Overview

The **Profile** feature allows an authenticated user to view and update their account information, including their name, email, phone number, and password.

**Application:** [https://admin.nexolvi.ai](https://admin.nexolvi.ai)

## 2. Preconditions

* User has valid login credentials.
* User is able to successfully log in to Nexo Desk.

## 3. Login Flow

1. User navigates to `https://admin.nexolvi.ai`.
2. Login page is displayed.
3. Login form contains:

   * **Email** field
   * **Password** field
   * **Remember me for 30 days** checkbox
   * **Sign In** button
4. User enters `{{validEmail}}` in the Email field.
5. User enters `{{validPassword}}` in the Password field.
6. User clicks **Sign In**.
7. User is redirected to the **Nexo Desk Dashboard**.

## 4. Profile Menu

On the Dashboard:

1. A profile button displaying the **first initial of the user's email/name** is visible at the top-left corner.
2. When the user hovers over the profile button, the user's email is displayed.
3. When the user clicks the profile button, a user menu is displayed.
4. The menu contains:

   * User initial
   * User email
   * **Profile**
   * **Logout**

## 5. Open Profile

When the user clicks **Profile**:

A **My Profile** modal is displayed.

### Modal Header

**Title:** `My Profile`

**Description:**
`View and edit your account information.`

A **Close (X)** button is displayed in the top-right corner.

## 6. Profile Information

The profile modal displays the user's account information.

### User Information

| Field | Description                                  |
| ----- | -------------------------------------------- |
| Name  | Displays the user's name                     |
| Email | Displays the user's registered email address |
| Phone | Displays the user's registered phone number  |

Example:

* **Name:** `bikash.h`
* **Email:** `bikash.htc@gmail.com`
* **Phone:** `+1 555 000 0000`

The fields should allow the user to edit their account information where applicable.

## 7. Change Password

The Profile modal contains a **Change Password** section.

### New Password

* Label: **New Password**
* Input field
* Placeholder: `Leave blank to keep current`

### Confirm Password

* Label: **Confirm Password**
* Input field
* Placeholder: `Repeat new password`

### Password Behavior

* If both password fields are left blank, the existing password remains unchanged.
* If a new password is entered, the Confirm Password field must match the New Password field.
* Password validation should be performed before saving the changes.

## 8. Profile Actions

The modal contains two buttons:

### Cancel

* Closes the Profile modal.
* Discards unsaved changes.
* User remains on the Dashboard.

### Save Changes

* Validates the entered information.
* Saves the updated profile information when validation succeeds.
* Updated information should be reflected in the user's profile after saving.

## 9. Acceptance Criteria

| ID    | Acceptance Criteria                                                                              |
| ----- | ------------------------------------------------------------------------------------------------ |
| AC-01 | Profile button displays the user's initial.                                                      |
| AC-02 | User email is displayed when hovering over the profile button.                                   |
| AC-03 | Clicking the profile button displays the user menu.                                              |
| AC-04 | User menu contains a **Profile** option.                                                         |
| AC-05 | Clicking Profile opens the **My Profile** modal.                                                 |
| AC-06 | Modal displays `My Profile` as the header.                                                       |
| AC-07 | Modal displays `View and edit your account information.`                                         |
| AC-08 | Modal contains Name, Email, and Phone fields.                                                    |
| AC-09 | Modal contains a **Change Password** section.                                                    |
| AC-10 | New Password and Confirm Password fields are displayed.                                          |
| AC-11 | Blank password fields preserve the existing password.                                            |
| AC-12 | Mismatched new and confirm passwords are rejected.                                               |
| AC-13 | Clicking **Cancel** closes the modal without saving changes.                                     |
| AC-14 | Clicking **Save Changes** validates and saves valid profile changes.                             |
| AC-15 | Clicking the **X** button closes the Profile modal.                                              |
| AC-16 | Successfully saved profile information is reflected when the user opens the Profile modal again. |
