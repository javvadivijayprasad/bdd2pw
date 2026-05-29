Feature: Status code accepted from a list

  @api
  Scenario: Health endpoint may return 200 or 204
    When I send a GET request to "/api/health"
    Then the response status is in [200, 204]
    And the response status is less than 300
