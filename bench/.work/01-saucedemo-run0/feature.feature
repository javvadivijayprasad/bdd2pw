Feature: SauceDemo authentication

  Scenario: Standard user logs in successfully
    Given I am on the SauceDemo login page
    When I enter "standard_user" as my username
    And I enter "secret_sauce" as my password
    And I click the Login button
    Then the URL should contain "inventory.html"

  Scenario: Locked-out user is rejected
    Given I am on the SauceDemo login page
    When I enter "locked_out_user" as my username
    And I enter "secret_sauce" as my password
    And I click the Login button
    Then I should see the error message "Sorry, this user has been locked out"

  Scenario: Empty credentials are rejected
    Given I am on the SauceDemo login page
    When I click the Login button
    Then I should see the error message "Username is required"
