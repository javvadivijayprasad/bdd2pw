Feature: TestForge Issue 4 — opt-in step hook callouts

  Scenario: Each test.step wraps in beforeStep/afterStep when enabled
    Given I am on the login page
    When I click the submit button
