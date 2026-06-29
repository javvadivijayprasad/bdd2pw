Feature: PrestaShop AutomationPractice journey

  Scenario: Create an account
    Given I am on the authentication page
    When I enter "bench@example.com" as my account email
    And I click the Create an account button
    Then I should see the account registration form

  Scenario: Sign in with existing account
    Given I am on the authentication page
    When I enter "bench@example.com" as my email
    And I enter "BenchPass1!" as my password
    And I click the Sign in button
    Then I should be on the My Account page

  Scenario: Search and add to cart
    Given I am on the home page
    When I search for "shirt"
    And I click the first product result
    And I click the Add to Cart button
    Then I should see the cart summary
