Feature: Simple GET request

  @api @smoke
  Scenario: Fetch the root health endpoint
    When I send a GET request to "/api/health"
    Then the response status is 200
