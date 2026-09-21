# Logout Feature – Requirement Document

## 1. Feature Overview

The Logout feature allows an authenticated user to securely log out of **Nexo Desk** and return to the Login page.

**Application:** [https://admin.nexolvi.ai](https://admin.nexolvi.ai)

## 2. Preconditions

* User has valid login credentials.
* User is successfully logged into the Nexo Desk Dashboard.
* `{{validEmail}}` represents the user's valid email address.

## 3. Login Flow

1. User navigates to `https://admin.nexolvi.ai`.
2. Login page is displayed.
3. Login form contains:

   * **Email** field
   * **Password** field
   * **Remember me for 30 days** checkbox
   * **Sign In** button
4. User enters `{{validEmail}}` and `{{validPassword}`.
5. User clicks **Sign In**.
6. User is redirected to the **Nexo Desk Dashboard**.

## 4. User Profile / Logout

On the Dashboard:

1. A profile button displaying the **first initial of the user's email** is visible at the top-left corner.
2. On hovering over the profile button, the user's email is displayed.
3. Clicking the profile button opens the user menu containing:

   * User initial
   * User email
   * **Profile**
   * **Logout**

![Image](https://images.openai.com/static-rsc-4/KOZe9FwjZRKmdqc_aCf6lk3Ci5zF5fvqH2XFRL-XcOzO23CdQwDK6bCKF4lbgcu4K4l5j3zQ6sYRrWpXzWArDmyRvKmPnQ4Lm6w-dBAQ88JbZJCu_a4RZixHllQr1OY_JIwW7b4fUgeSd2NzBamIHHno2ALzO7Xo7pa1-ebH62Qnv9K0cvZSXpIA9QVEpCxL?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/6KwwV0mLLM16hvClWRd56wgT9pR-hpiXHYuFhXn3cf1wztbNQCGapcY9I7Fy68oHp93yAqanxwNrqqJMtn_VECjPv5SlSRIj4FJs9LMCAtfodAoQ8tk7GhmEaeV2wDX-7wLYglnxUawU9-_E8kMspS7xQ8rJEyqwMeg3X9Z5FGrZuTUKqLdAL-g-3-9xpnLi?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/1ixZTwYurdVND1bOkZf_Nr42Ee1pG4egRdRyjwrCVdF4jbDLOcP_61N6Ox4fa_jjgQWgTwG15kfFnDDpvLw-O4XMnZj5v9jGHXEnCGlYyoYKFhU-V4rF5jhuc4eo-lX_nA80S-Kots-hJZ7HQHViTKMvYkY4msN29ZIXP2LPIgRylxz0ai73D0eN7a8zfZ-o?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/2iYd1mCflacUaCEmnfDu8wF3jnq679zXEpV-fbyKzx-RQAnFz5eQKPlFapXcKIPc4ovxQlxpAMWE5us4IJ8Lz6j3l03TYB0x_xnVSj0S4GIW02QaI8tK7M-VYbRn2U__KosahIM9cuCyZJAR7FOMVWW-jvQels0KmfznRuVG_D35tpgMv2EC-E__7l_XoAZ_?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/dYERmNLdIoKRUryPduDukjDRV9Bs1eAI1IIwd1ww110_-o5vez7PGCJqoIqmDkx133jdI_kz5wClUX_4jEwhA4vJgPFmFKpX9DT3sx6x0WFqN_NOT23Tk3uBEJwK_sUuuokrdLtuTocQFPyQIkGAb75Gz1taU3401CU_6iEEvvDVnYUY7Qyblb1QIjs68eKF?purpose=fullsize)

## 5. Logout Confirmation

When the user clicks **Logout**:

A confirmation popup is displayed with:

**Header:**
`Log out?`

**Message:**
`Are you sure you want to log out? Any unsaved changes will be lost.`

**Actions:**

* **Cancel**
* **Logout**

### Cancel Behavior

* Clicking **Cancel** closes the confirmation popup.
* User remains on the Dashboard.
* User remains authenticated.

### Logout Behavior

* Clicking **Logout** terminates the user's authenticated session.
* User is redirected to the **Login page**.
* The user should not be able to access authenticated Dashboard pages using the terminated session.

## 6. Acceptance Criteria

| ID    | Acceptance Criteria                                                                          |
| ----- | -------------------------------------------------------------------------------------------- |
| AC-01 | Profile button displays the user's first initial.                                            |
| AC-02 | User email is displayed when hovering over the profile button.                               |
| AC-03 | Clicking the profile button displays the user menu.                                          |
| AC-04 | User menu contains a **Logout** option.                                                      |
| AC-05 | Clicking Logout displays the confirmation popup.                                             |
| AC-06 | Popup contains `Log out?` as the header.                                                     |
| AC-07 | Popup contains the specified unsaved-changes warning message.                                |
| AC-08 | Popup contains **Cancel** and **Logout** buttons.                                            |
| AC-09 | Clicking Cancel closes the popup without logging out the user.                               |
| AC-10 | Clicking Logout ends the authenticated session and redirects the user to the Login page.     |
| AC-11 | After logout, the user cannot access the Dashboard using the previous authenticated session. |
