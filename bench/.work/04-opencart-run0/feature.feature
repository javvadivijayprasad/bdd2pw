Feature: OpenCart returning customer login and browse

  Scenario: Returning customer logs in
    Given I am on the account login page
    When I enter "demo@opencart.com" as my email
    And I enter "demo123" as my password
    And I click the Login button
    Then I should be on the My Account page

  Scenario: Add a product to the cart
    Given I am on the home page
    When I search for "iPhone"
    And I click the first product result
    And I click the Add to Cart button
    Then the cart count should be 1

  Scenario: View checkout page
    Given I have 1 item in the cart
    When I navigate to the checkout page
    Then I should see the order summary
