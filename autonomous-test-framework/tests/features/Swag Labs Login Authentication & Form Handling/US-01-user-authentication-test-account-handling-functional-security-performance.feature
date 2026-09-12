Feature: Swag Labs Login Authentication & Form Handling
  As a user of the application,
  I want to Authenticate users against defined test account roles and route them to appropriate application states or error conditions.
  So that access protected functionality.

  Background:
    Given the user is on the login page

  @positive @functional @ui @regression @tc-001
  Scenario: [TC-001] Given a user enters valid credentials for standard_user
    Given Navigate to the feature: User Authentication & Test Account Handling (@functional @security @performance)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: a user enters valid credentials for 'standard_user' with password 'secret_sauce'
    And with test data "{{validPassword}}"
    Then System confirms: Given a user enters valid credentials for 'standard_user' with password 'secret_sauce', the system authenticates the user, stores the session token in Local Storage, and redirects to '/inventory.html'.
    Then System confirms: Given a user enters valid credentials for 'standard_user' with password 'secret_sauce', the system authenticates the user, stores the session token in Local Storage, and redirects to '/inventory.html'.

  @positive @functional @ui @regression @tc-002
  Scenario: [TC-002] Given a user enters credentials for locked_out_user wit
    Given Navigate to the feature: User Authentication & Test Account Handling (@functional @security @performance)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: a user enters credentials for 'locked_out_user' with password 'secret_sauce', th
    And with test data "{{validPassword}}"
    Then System confirms: Given a user enters credentials for 'locked_out_user' with password 'secret_sauce', the system blocks authentication and displays the error message 'Epic sadface: Sorry, this user has been locked out.' without redirecting.
    Then System confirms: Given a user enters credentials for 'locked_out_user' with password 'secret_sauce', the system blocks authentication and displays the error message 'Epic sadface: Sorry, this user has been locked out.' without redirecting.

  @positive @functional @ui @regression @tc-003
  Scenario: [TC-003] Given a user enters credentials for performance_glitch_u
    Given Navigate to the feature: User Authentication & Test Account Handling (@functional @security @performance)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: a user enters credentials for 'performance_glitch_user' with password 'secret_sa
    And with test data "{{validPassword}}"
    Then System confirms: Given a user enters credentials for 'performance_glitch_user' with password 'secret_sauce', the system completes authentication and redirects to catalog within the acceptable 5000 ms threshold.
    Then System confirms: Given a user enters credentials for 'performance_glitch_user' with password 'secret_sauce', the system completes authentication and redirects to catalog within the acceptable 5000 ms threshold.

  @positive @functional @ui @regression @tc-004
  Scenario: [TC-004] Given a user enters credentials for problem_user with p
    Given Navigate to the feature: User Authentication & Test Account Handling (@functional @security @performance)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: a user enters credentials for 'problem_user' with password 'secret_sauce', the s
    And with test data "{{validPassword}}"
    Then System confirms: Given a user enters credentials for 'problem_user' with password 'secret_sauce', the system logs in successfully and displays catalog items with visual inconsistencies where all products share the same image.
    Then System confirms: Given a user enters credentials for 'problem_user' with password 'secret_sauce', the system logs in successfully and displays catalog items with visual inconsistencies where all products share the same image.

  @positive @functional @ui @regression @tc-005
  Scenario: [TC-005] Given a user enters credentials for error_user with pas
    Given Navigate to the feature: User Authentication & Test Account Handling (@functional @security @performance)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: a user enters credentials for 'error_user' with password 'secret_sauce', the sys
    And with test data "{{validPassword}}"
    Then System confirms: Given a user enters credentials for 'error_user' with password 'secret_sauce', the system logs in successfully, displays an error dialog stating 'credentials are compromise', and renders all product items with the same image.
    Then System confirms: Given a user enters credentials for 'error_user' with password 'secret_sauce', the system logs in successfully, displays an error dialog stating 'credentials are compromise', and renders all product items with the same image.

  @positive @functional @ui @regression @tc-006
  Scenario: [TC-006] Given a user enters credentials for visual_user with pa
    Given Navigate to the feature: User Authentication & Test Account Handling (@functional @security @performance)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: a user enters credentials for 'visual_user' with password 'secret_sauce', the sy
    And with test data "{{validPassword}}"
    Then System confirms: Given a user enters credentials for 'visual_user' with password 'secret_sauce', the system completes login and renders all products displaying the same image.
    Then System confirms: Given a user enters credentials for 'visual_user' with password 'secret_sauce', the system completes login and renders all products displaying the same image.

  @positive @functional @ui @regression @tc-007
  Scenario: [TC-007] Given invalid username or password credentials are submit
    Given Navigate to the feature: User Authentication & Test Account Handling (@functional @security @performance)
    And with test data "{{validBaseURL}}"
    Then Feature is accessible and loaded correctly
    When Authenticate with valid credentials
    And with test data "{{validUsername}} / {{validPassword}}"
    Then User is authenticated and redirected to correct page
    When Perform action: invalid username or password credentials are submitted, the system displays erro
    And with test data "{{validPassword}}"
    Then System confirms: Given invalid username or password credentials are submitted, the system displays error message 'Epic sadface: Username and password do not match any user in this service'.
    Then System confirms: Given invalid username or password credentials are submitted, the system displays error message 'Epic sadface: Username and password do not match any user in this service'.
    Then Changes are retained after page reload
