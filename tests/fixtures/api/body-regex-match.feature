Feature: Body field regex match

  @api
  Scenario: Generated user id is a UUID
    When I send a POST request to "/api/users" with body:
      """
      { "name": "Test User" }
      """
    Then the response status is 201
    And the response body field "id" matches /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
