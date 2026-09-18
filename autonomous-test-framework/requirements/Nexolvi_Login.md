# PRD – Login

**Feature:** Login
**URL:** [Nexolvi Admin Login](https://admin.nexolvi.ai)

### Objective

Allow authorized users to securely log in to **Nexo Desk** using their email and password.

### Requirements

1. **Email & Password**

   * User must enter both email and password.
   * **Sign In** remains disabled until both fields have values.

2. **Password Visibility**

   * Password is masked by default.
   * Eye icon toggles between masked and visible password.

3. **Remember Me**

   * Checkbox: **Remember me for 30 days**.
   * When selected during successful login, the user's login session is remembered for 30 days.

4. **Login Validation**

   * Invalid email + valid password → `Login failed`
   * Valid email + invalid password → `Login failed`
   * Invalid email + invalid password → `Login failed`

5. **Successful Login**

   * Valid email + valid password → User is authenticated.
   * User is redirected to the **Nexo Desk Dashboard**.

### Test Credentials

* **Email:** `bikash.htc@gmail.com`
* **Password:** `admin@123`

### Acceptance Criteria

| Scenario              | Expected Result                 |
| --------------------- | ------------------------------- |
| Both fields empty     | Sign In disabled                |
| Only email entered    | Sign In disabled                |
| Only password entered | Sign In disabled                |
| Both fields entered   | Sign In enabled                 |
| Invalid credentials   | `Login failed`                  |
| Valid credentials     | Redirect to Nexo Desk Dashboard |
| Eye icon clicked      | Password visibility toggles     |
| Remember Me selected  | Session remembered for 30 days  |
