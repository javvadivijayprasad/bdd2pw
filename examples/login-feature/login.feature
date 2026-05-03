Feature: User Login
  As a registered user
  I want to log in with my username and password
  So that I can access my dashboard

  Background:
    Given I am on the login page

  Scenario: Successful login with valid credentials
    When I enter "alice@example.com" into the username field
    And I enter "correct-horse-battery-staple" into the password field
    And I click the login button
    Then I should see the dashboard
    And I should see the welcome message "Welcome, Alice"

  Scenario: Failed login with wrong password
    When I enter "alice@example.com" into the username field
    And I enter "wrong-password" into the password field
    And I click the login button
    Then I should see the error message "Invalid credentials"
    And I should remain on the login page

  Scenario Outline: Login validation errors
    When I enter "<username>" into the username field
    And I enter "<password>" into the password field
    And I click the login button
    Then I should see the error message "<error>"

    Examples:
      | username           | password | error                     |
      |                    | secret   | Username is required      |
      | alice@example.com  |          | Password is required      |
      | not-an-email       | secret   | Username must be an email |
