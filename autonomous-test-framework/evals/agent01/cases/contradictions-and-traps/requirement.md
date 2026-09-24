# Sign-in Page — Requirements

**Application:** https://portal.example.test

## User Story

**Story ID:** ACC-101
**As a** returning customer **I want to** sign in with my email and password **so that** I can see my orders.

## Acceptance Criteria

| ID   | Criterion                                                                        |
|------|----------------------------------------------------------------------------------|
| AC-1 | The sign-in page shows the heading `Welcome back`.                               |
| AC-2 | The page has an **Email** field, a **Password** field and a **Sign in** button.  |
| AC-3 | The **Sign in** button is enabled only when both fields are filled.              |
| AC-4 | Submitting valid credentials opens the page `/orders`.                           |
| AC-5 | Submitting a wrong password shows the error `Email or password is incorrect`.   |
| AC-6 | The page must load quickly.                                                      |

## Business Rules

- BR-1: The **Sign in** button is enabled at all times.
- BR-2: The password must be between 8 and 64 characters.

## Test Account

- Email: `buyer@example.test`
- Password: `Buyer#Pass2026`

## Out of Scope

Creating an account and password reset are not part of this page.
