Feature: Retail domain rules

  Scenario: Cart, checkout, and order
    When I add "Widget" to the cart
    Then the cart has 1 items
    And the price is "$19.99"
    And the subtotal is "$19.99"
    And the order total is "$22.49"
    When I apply promo code "SAVE10"
    Then the discount is "$2.00"
    When I complete the checkout
    Then the order status is "pending"
    And the order number is "ORD-12345"
    And the SKU is "WID-0001"
    And the item is "in stock"
    And the shipping address is "123 Main St"
    And the estimated delivery is "2026-06-05"
    And the product name is "Widget"
    And the rating is 4.5 stars
    And there are 25 reviews
