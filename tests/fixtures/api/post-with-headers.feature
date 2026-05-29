Feature: POST with custom header

  @api
  Scenario: Submit a comment with an idempotency key
    When I send a POST request to "/api/comments" with header "Idempotency-Key" set to "abc-123"
    Then the response status is 201
    And the response header "Content-Type" contains "application/json"
