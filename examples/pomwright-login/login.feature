Feature: Login (POMWright target PoC)

  v4.7.0 — demonstrates the `--target=pomwright` output shape. The scaffolder
  produces a `LoginPage extends PageObject<Paths>` with locators registered
  under a POMWright LocatorRegistry, and a spec that reaches them via
  `loginPage.getNestedLocator("main.form@login.input@username")`.

  Scaffold command:
    npx bdd2pw scaffold ./login.feature \
      --url https://practicetestautomation.com/practice-test-login/ \
      --page LoginPage \
      --target=pomwright \
      --repo ./out \
      --snapshot-file ./snapshot.json

  Scenario: Successful login
    Given I am on the login page
    When I enter "student" into the username field
    And I enter "Password123" into the password field
    And I click the Submit button
    Then I should see the "Logged In Successfully" heading

  Scenario: Failed login with wrong password
    Given I am on the login page
    When I enter "student" into the username field
    And I enter "wrong" into the password field
    And I click the Submit button
    Then I should see the "Your password is invalid!" error message
