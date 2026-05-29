Feature: TestForge Issue 5 — opt-in step boundary markers

  Scenario: Each test.step is bracketed by stable marker comments
    Given I am on the login page
    When I click the submit button
    Then I should see "Welcome"
