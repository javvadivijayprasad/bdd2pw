Feature: the-internet form authentication

  Scenario: Successful login
    Given I am on the form auth page
    When I enter "tomsmith" as my username
    And I enter "SuperSecretPassword!" as my password
    And I click the Login button
    Then I should see the success message "You logged into a secure area!"

  Scenario: Invalid username rejected
    Given I am on the form auth page
    When I enter "invalid_user" as my username
    And I enter "wrong_pw" as my password
    And I click the Login button
    Then I should see the error message "Your username is invalid!"

  Scenario: Logout from secure area
    Given I am logged in to the secure area
    When I click the Logout button
    Then I should see the success message "You logged out of the secure area!"

  Scenario: Visit dynamic loading page
    Given I am on the dynamic loading page
    When I click the Start button
    Then I should see the text "Hello World!"
