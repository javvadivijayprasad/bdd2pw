Feature: Mixed UI and API in one scenario

  @ui @api
  Scenario: Submit the contact form via UI and verify via API
    Given I am on the contact page
    When I enter "alice@example.com" into the email field
    And I click the submit button
    Then I should see "Thanks!"
    When I send a GET request to "/api/contacts/latest"
    Then the response status is 200
    And the response body field "email" equals "alice@example.com"
