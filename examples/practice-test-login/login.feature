@ui @login
Feature: User Login
  As a user of the application
  I want to log in with my credentials
  So that I can access the application

  # ── Test site: https://practicetestautomation.com/practice-test-login/
  # Valid credentials : student / Password123
  # Invalid credentials: test   / test  → "Your username is invalid!"

  Background:
    Given I am on the login page

  # ─── Positive ──────────────────────────────────────────────────────────────

  @smoke @positive
  Scenario: Successful login with valid credentials
    When I enter username "student"
    And I enter password "Password123"
    And I click the login button
    Then I should be redirected to the logged-in page
    And I should see a welcome message containing "Congratulations"

  # ─── Negative ──────────────────────────────────────────────────────────────

  @smoke @negative
  Scenario: Login fails with invalid username and password
    When I enter username "test"
    And I enter password "test"
    And I click the login button
    Then I should see an error message "Your username is invalid!"
    And I should remain on the login page

  @negative
  Scenario: Login fails with valid username but wrong password
    When I enter username "student"
    And I enter password "wrongpassword"
    And I click the login button
    Then I should see an error message "Your password is invalid!"
    And I should remain on the login page

  @negative
  Scenario Outline: Login fails when credentials are empty
    When I enter username "<username>"
    And I enter password "<password>"
    And I click the login button
    Then I should see an error message "<errorMessage>"

    Examples:
      | username | password    | errorMessage               |
      |          | Password123 | Your username is invalid!  |
      | student  |             | Your password is invalid!  |

  # ─── Security ──────────────────────────────────────────────────────────────

  @security
  Scenario: Password field masks the entered text
    Then the password field should be of type "password"

  @security
  Scenario: Login page is served over HTTPS
    Then the current URL should start with "https"
