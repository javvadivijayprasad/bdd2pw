Feature: Body field equality (string and numeric)

  @api
  Scenario: Fetch a user and verify fields
    When I send a GET request to "/api/users/42"
    Then the response status is 200
    And the response body field "username" equals "alice"
    And the response body field "id" equals 42
