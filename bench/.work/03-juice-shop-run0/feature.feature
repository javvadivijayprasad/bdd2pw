Feature: OWASP Juice Shop authentication

  Scenario: Register a new account
    Given I am on the Juice Shop login page
    When I click the Not yet a customer link
    And I enter "bench@example.com" as my email
    And I enter "ValidPass1!" as my password
    And I enter "ValidPass1!" as my password confirmation
    And I select "Your eldest siblings middle name?" as my security question
    And I enter "Alex" as my security answer
    And I click the Register button
    Then I should see the success message "Registration completed successfully"

  Scenario: Login with existing credentials
    Given I am on the Juice Shop login page
    When I enter "bench@example.com" as my email
    And I enter "ValidPass1!" as my password
    And I click the Log in button
    Then I should be on the search page

  Scenario: Login with invalid credentials
    Given I am on the Juice Shop login page
    When I enter "invalid@example.com" as my email
    And I enter "wrong" as my password
    And I click the Log in button
    Then I should see the error message "Invalid email or password"
