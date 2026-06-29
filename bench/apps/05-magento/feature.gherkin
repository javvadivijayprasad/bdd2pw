Feature: Magento customer journey

  Scenario: Customer logs in
    Given I am on the customer login page
    When I enter "bench@example.com" as my email
    And I enter "BenchPass1!" as my password
    And I click the Sign In button
    Then I should be on the My Account page

  Scenario: Browse the Men category
    Given I am on the home page
    When I hover over the Men menu
    And I click the Tops menu item
    Then I should see at least 12 product tiles

  Scenario: Add a configurable product to the cart
    Given I am on a product detail page
    When I select size "M"
    And I select color "Blue"
    And I click the Add to Cart button
    Then the cart count should be 1
