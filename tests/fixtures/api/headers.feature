Feature: Header assertions

  @api
  Scenario: Verify Content-Type, ETag, and X-RateLimit
    When I send a GET request to "/api/data"
    Then the response status is 200
    And the response header "Content-Type" equals "application/json; charset=utf-8"
    And the response header "Cache-Control" contains "no-cache"
    And the response header "X-RateLimit-Remaining" is set
